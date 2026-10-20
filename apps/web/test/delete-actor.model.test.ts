import { EditScope, Provider } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Deferred, Effect, Option, Queue, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { SnapshotFrom } from "xstate";
import { getShortestPaths } from "xstate/graph";

import type {
  DeleteCommit,
  DeleteIntent,
} from "../src/client/editing/delete-actor.js";
import {
  DeleteCommitResult,
  DeleteOutcome,
  DeletionWriter,
  deleteUndoMachine,
  undoWindowMilliseconds,
} from "../src/client/editing/delete-actor.js";
import type { MutationFailureValue } from "../src/client/editing/failure.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";

type DeleteActor = EffectActor<typeof deleteUndoMachine>;

type DeleteSnapshot = SnapshotFrom<typeof deleteUndoMachine>;

type Phase = "pending" | "committing" | "undone" | "committed" | "failed";

interface Reference {
  elapsed: number;
  keepalive: boolean;
  phase: Phase;
}

const intent = (
  id: string,
  scope: typeof EditScope.Type = "single"
): typeof DeleteIntent.Type => ({
  event: {
    accountId: "work",
    calendarId: "primary",
    end: { dateTime: "2026-10-19T10:00:00-07:00" },
    eventId: "fixture-event",
    iCalUID: "fixture@example.test",
    start: { dateTime: "2026-10-19T09:00:00-07:00" },
    status: "confirmed",
    title: "Fixture event",
  },
  id,
  navigation: initialNavigation(dayFromIso("2026-10-19")),
  request: {
    accountId: "work",
    calendarId: "primary",
    eventId: "fixture-event",
    scope,
    sendUpdates: "none",
  },
  selection: Option.some("fixture-selection"),
  title: "Fixture event",
});

const rejection = new Provider({
  message: "Fixture provider refused deletion",
  operation: "deleteEvent",
  status: 403,
});

const harness = Effect.fn("deleteHarness")(function* harness(id: string) {
  const calls: (typeof DeleteCommit.Type)[] = [];
  const started = yield* Deferred.make<boolean>();
  const completed = yield* Deferred.make<boolean, MutationFailureValue>();

  const writer = DeletionWriter.of({
    commit: Effect.fn("fakeDeleteCommit")(function* commit(
      input: typeof DeleteCommit.Type
    ) {
      calls.push(input);
      yield* Deferred.succeed(started, true);
      yield* Deferred.await(completed);
    }),
  });

  const actor = yield* createEffectActor(deleteUndoMachine, {
    input: { intent: intent(id), windowMilliseconds: undoWindowMilliseconds },
  }).pipe(Effect.provideService(DeletionWriter, writer));

  yield* watchActor("deleteUndoTest", actor);

  return { actor, calls, completed, started };
});

type Harness = Effect.Success<ReturnType<typeof harness>>;

const observeTrigger = Effect.fn("observeDeleteTrigger")(
  function* observeTrigger(actor: DeleteActor, trigger: Effect.Effect<void>) {
    if (actor.getSnapshot().status !== "active") {
      yield* trigger;

      return actor.getSnapshot();
    }

    const queue = yield* Queue.unbounded<DeleteSnapshot>();

    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        actor.subscribe((snapshot) => {
          Queue.offerUnsafe(queue, snapshot);
        })
      ),
      () => trigger.pipe(Effect.andThen(Queue.take(queue))),
      (subscription) =>
        Effect.sync(() => {
          subscription.unsubscribe();
        })
    );
  }
);

const control = (
  actor: DeleteActor,
  event: Parameters<DeleteActor["send"]>[0]
) => observeTrigger(actor, send(actor, event));

const Command = Schema.TaggedUnion({
  Dismiss: {},
  Fail: {},
  Leave: {},
  Succeed: {},
  Undo: {},
  Wait: {
    milliseconds: Schema.Int.check(
      Schema.isBetween({ maximum: 9000, minimum: 0 })
    ),
  },
});

const applyCommand = Effect.fn("applyDeleteCommand")(function* applyCommand(
  h: Harness,
  model: Reference,
  command: typeof Command.Type
) {
  yield* Command.match<Effect.Effect<void>>(command, {
    Dismiss: () =>
      Effect.gen(function* dismiss() {
        yield* control(h.actor, { type: "DISMISS" });

        if (model.phase === "pending") {
          model.phase = "committing";
        }
      }),
    Fail: () =>
      Effect.gen(function* fail() {
        if (model.phase === "committing") {
          yield* Deferred.await(h.started);
          yield* observeTrigger(
            h.actor,
            Deferred.fail(h.completed, rejection).pipe(Effect.asVoid)
          );
          model.phase = "failed";
        }
      }),
    Leave: () =>
      Effect.gen(function* leave() {
        yield* control(h.actor, { type: "PAGE_HIDDEN" });

        if (model.phase === "pending") {
          model.phase = "committing";
          model.keepalive = true;
        }
      }),
    Succeed: () =>
      Effect.gen(function* succeed() {
        if (model.phase === "committing") {
          yield* Deferred.await(h.started);
          yield* observeTrigger(
            h.actor,
            Deferred.succeed(h.completed, true).pipe(Effect.asVoid)
          );
          model.phase = "committed";
        }
      }),
    Undo: () =>
      Effect.gen(function* undo() {
        yield* control(h.actor, { type: "UNDO" });

        if (model.phase === "pending") {
          model.phase = "undone";
        }
      }),
    Wait: ({ milliseconds }) =>
      Effect.gen(function* wait() {
        model.elapsed += milliseconds;
        yield* TestClock.adjust(milliseconds);

        if (
          model.phase === "pending" &&
          model.elapsed >= undoWindowMilliseconds
        ) {
          model.phase = "committing";
        }
      }),
  });
});

const assertModel = Effect.fn("assertDeleteModel")(function* assertModel(
  h: Harness,
  model: Reference
) {
  if (
    model.phase === "committing" ||
    model.phase === "committed" ||
    model.phase === "failed"
  ) {
    yield* Deferred.await(h.started);
    expect(h.calls).toEqual([
      {
        keepalive: model.keepalive,
        request: intent("generated-delete").request,
      },
    ]);
  } else {
    expect(h.calls).toHaveLength(0);
  }

  const snapshot = h.actor.getSnapshot();
  expect(snapshot.value).toBe(model.phase);
  expect(snapshot.context.keepalive).toBe(model.keepalive);
  expect(snapshot.context.intent).toEqual(intent("generated-delete"));

  if (model.phase === "undone") {
    expect(snapshot.output).toEqual(
      DeleteOutcome.cases.Undone.make({ id: "generated-delete" })
    );
  }

  if (model.phase === "committed") {
    expect(snapshot.output).toEqual(
      DeleteOutcome.cases.Committed.make({ id: "generated-delete" })
    );
  }

  if (model.phase === "failed") {
    expect(snapshot.output).toEqual(
      DeleteOutcome.cases.Failed.make({
        failure: rejection,
        id: "generated-delete",
      })
    );
  }
});

it.effect.prop(
  "real delete histories preserve the Undo deadline, request mode, typed failure and terminal immutability",
  { commands: Schema.Array(Command) },
  ({ commands }) =>
    Effect.gen(function* deleteHistory() {
      const h = yield* harness("generated-delete");

      const model: Reference = {
        elapsed: 0,
        keepalive: false,
        phase: "pending",
      };

      for (const command of commands.slice(0, 20)) {
        yield* applyCommand(h, model, command);
        yield* assertModel(h, model);
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "Undo before expiry never calls the provider, including after the old deadline",
  () =>
    Effect.gen(function* undoBeforeDeadline() {
      const h = yield* harness("undo");
      yield* TestClock.adjust(7999);
      expect(h.calls).toHaveLength(0);
      yield* control(h.actor, { type: "UNDO" });
      yield* TestClock.adjust(9000);
      expect(h.calls).toHaveLength(0);
      expect(h.actor.getSnapshot().output).toEqual(
        DeleteOutcome.cases.Undone.make({ id: "undo" })
      );
    })
);

it.effect("independent deletion windows do not cancel one another", () =>
  Effect.gen(function* independentWindows() {
    const first = yield* harness("first");
    yield* TestClock.adjust(3000);
    const second = yield* harness("second");
    yield* TestClock.adjust(4999);
    expect(first.calls).toHaveLength(0);
    expect(second.calls).toHaveLength(0);
    yield* TestClock.adjust(1);
    yield* Deferred.await(first.started);
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
    yield* control(second.actor, { type: "UNDO" });
    yield* observeTrigger(
      first.actor,
      Deferred.succeed(first.completed, true).pipe(Effect.asVoid)
    );
    yield* TestClock.adjust(9000);
    expect(first.actor.getSnapshot().output).toEqual(
      DeleteOutcome.cases.Committed.make({ id: "first" })
    );
    expect(second.actor.getSnapshot().output).toEqual(
      DeleteOutcome.cases.Undone.make({ id: "second" })
    );
    expect(second.calls).toHaveLength(0);
  })
);

it.effect(
  "pagehide commits with keepalive and preserves a typed provider rejection",
  () =>
    Effect.gen(function* pagehideCommit() {
      const h = yield* harness("pagehide");
      yield* control(h.actor, { type: "PAGE_HIDDEN" });
      yield* Deferred.await(h.started);
      expect(h.calls).toEqual([
        { keepalive: true, request: intent("pagehide").request },
      ]);
      yield* observeTrigger(
        h.actor,
        Deferred.fail(h.completed, rejection).pipe(Effect.asVoid)
      );
      expect(h.actor.getSnapshot().output).toEqual(
        DeleteOutcome.cases.Failed.make({ failure: rejection, id: "pagehide" })
      );
    })
);

it.effect(
  "closing an abandoned runtime leaves no timer that can delete on a later visit",
  () =>
    Effect.gen(function* noStaleDelete() {
      const calls = yield* Effect.scoped(
        Effect.gen(function* previousVisit() {
          const h = yield* harness("abandoned");

          return h.calls;
        })
      );

      yield* TestClock.adjust(16_000);
      expect(calls).toHaveLength(0);
      const fresh = yield* harness("new-visit");
      expect(fresh.actor.getSnapshot().value).toBe("pending");
      expect(fresh.calls).toHaveLength(0);
      yield* control(fresh.actor, { type: "UNDO" });
    })
);

it.effect.prop(
  "shortest lifecycle paths cover Undo, provider success and provider rejection",
  { scope: EditScope },
  ({ scope }) =>
    Effect.sync(() => {
      const input = {
        intent: intent("graph", scope),
        windowMilliseconds: undoWindowMilliseconds,
      };

      const paths = getShortestPaths(deleteUndoMachine, {
        events: [
          { type: "UNDO" },
          { type: "DISMISS" },
          { type: "PAGE_HIDDEN" },
          {
            actorId: "undoWindow",
            output: undefined,
            type: "xstate.done.actor",
          },
          {
            actorId: "deleteCommit",
            output: DeleteCommitResult.cases.Committed.make({}),
            type: "xstate.done.actor",
          },
          {
            actorId: "deleteCommit",
            output: DeleteCommitResult.cases.Failed.make({
              failure: rejection,
            }),
            type: "xstate.done.actor",
          },
        ],
        input,
        toState: (snapshot) => snapshot.status === "done",
      });

      expect(new Set(paths.map((path) => path.state.value))).toEqual(
        new Set(["undone", "committed", "failed"])
      );

      for (const path of paths) {
        expect(path.state.context.intent).toEqual(input.intent);

        if (path.state.value === "undone") {
          expect(path.state.output?._tag).toBe("Undone");
        }

        if (path.state.value === "committed") {
          expect(path.state.output?._tag).toBe("Committed");
        }

        if (path.state.value === "failed") {
          expect(path.state.output?._tag).toBe("Failed");
        }
      }
    })
);
