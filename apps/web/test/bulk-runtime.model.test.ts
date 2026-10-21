import { Provider } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Exit,
  Layer,
  Queue,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { BulkView } from "../src/client/bulk/model.js";
import { bulkPlanFor, bulkSummary } from "../src/client/bulk/selection.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import {
  DeleteOutcome,
  DeletionWriter,
} from "../src/client/editing/delete-actor.js";
import { DeleteNotice } from "../src/client/editing/deletion-session.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorMutation } from "../src/client/editing/editor-session-model.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { bulkRootFixture } from "./bulk-root-fixture.js";

const nextNotice = (
  queue: Queue.Dequeue<typeof EditingNotice.Type>,
  predicate: (notice: typeof EditingNotice.Type) => boolean
) =>
  Stream.fromQueue(queue).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption)
  );

const isSettled = (notice: typeof EditingNotice.Type) =>
  EditingNotice.guards.Bulk(notice) && BulkView.guards.Settled(notice.view);

const committed = (notice: typeof EditingNotice.Type) =>
  EditingNotice.guards.Delete(notice) &&
  DeleteNotice.guards.Settled(notice.notice) &&
  DeleteOutcome.guards.Committed(notice.notice.outcome);

const isUndone = (notice: typeof EditingNotice.Type) =>
  EditingNotice.guards.Delete(notice) &&
  DeleteNotice.guards.Settled(notice.notice) &&
  DeleteOutcome.guards.Undone(notice.notice.outcome);

const EditingArgs = Schema.Struct({
  command: EditingCommand,
  personId: Schema.String,
});

const harness = Effect.fn("bulkRootHarness")(function* harness(input: {
  readonly rejectBeta: boolean;
  readonly earlyDeleteFailure: boolean;
  readonly recurring?: boolean;
}) {
  const fixture = bulkRootFixture(false, input.recurring ?? false);
  const gate = yield* Deferred.make<boolean>();

  const created: {
    readonly title: string | undefined;
    readonly sendUpdates: string | undefined;
    readonly start: unknown;
    readonly end: unknown;
    readonly recurrence: readonly string[] | undefined;
  }[] = [];

  const deleted: string[] = [];
  const read: string[] = [];

  const failure = new Provider({
    message: "Google refused Beta.",
    operation: "createEvent",
    status: 403,
  });

  const client = CalendarEditingClient.of({
    createEvent: (request) =>
      Effect.gen(function* createMember() {
        created.push({
          end: request.event.end,
          recurrence: request.event.recurrence,
          sendUpdates: request.sendUpdates,
          start: request.event.start,
          title: request.event.title,
        });

        if (input.rejectBeta && request.event.title === "Beta") {
          return yield* failure;
        }

        const source = fixture.events.find(
          (event) => event.title === request.event.title
        );

        if (source === undefined) {
          return yield* Effect.die("Missing created source fixture.");
        }

        return {
          ...source,
          ...request.event,
          accountId: request.accountId,
          calendarId: request.calendarId,
          eventId: request.id,
        };
      }),
    deleteEvent: () =>
      Effect.die("Bulk deletion must use the existing staged-delete writer."),
    getEvent: (request) =>
      Effect.gen(function* readMember() {
        read.push(request.eventId);

        const source =
          request.eventId === "bulk-series"
            ? fixture.master
            : fixture.events.find((event) => event.eventId === request.eventId);

        if (source === undefined) {
          return yield* Effect.die("Unexpected source read.");
        }

        if (source.title === "Beta") {
          yield* Deferred.await(gate);
        }

        return source;
      }),
    moveAndRetimeSeries: () =>
      Effect.die("A bulk instance must not move a series."),
    moveEvent: () => Effect.die("Bulk duplicate is in-place, not a move."),
    moveSupport: "notAvailable",
    rsvp: () => Effect.die("Bulk actions do not RSVP."),
    updateEvent: () => Effect.die("Bulk copies must not update originals."),
  });

  const writer = DeletionWriter.of({
    commit: (intent) =>
      Effect.gen(function* commitMember() {
        expect(intent.request.scope).toBe("single");
        expect(intent.request.sendUpdates).toBe("none");
        deleted.push(intent.request.eventId);

        if (input.earlyDeleteFailure && intent.request.eventId === "bulk-0") {
          return yield* new Provider({
            message: "Google rejected Alpha cancellation.",
            operation: "deleteEvent",
            status: 403,
          });
        }

        return yield* Effect.void;
      }),
  });

  const services = Layer.merge(
    Layer.succeed(CalendarEditingClient, client),
    Layer.succeed(DeletionWriter, writer)
  );

  const context = yield* Layer.build(
    EditingRuntime.layer.pipe(Layer.provide(services))
  );

  const runtime = yield* Effect.service(EditingRuntime).pipe(
    Effect.provide(context)
  );

  const state = yield* Ref.make<AppModel>({
    ...fixture.model,
    calendar: { ...fixture.model.calendar, selected: fixture.keys },
  });

  const queue = yield* Queue.unbounded<typeof EditingNotice.Type>();
  const connectionScope = yield* Scope.make();
  yield* Effect.addFinalizer((exit) => Scope.close(connectionScope, exit));

  const notices = yield* runtime
    .connect(fixture.personId)
    .pipe(Effect.provideService(Scope.Scope, connectionScope));

  yield* notices.pipe(
    Stream.runForEach((notice) =>
      Ref.update(
        state,
        (model) =>
          update(
            model,
            Message.ReceivedEditing({ notice, personId: fixture.personId })
          ).model
      ).pipe(Effect.andThen(Queue.offer(queue, notice)))
    ),
    Effect.forkScoped
  );
  yield* nextNotice(
    queue,
    (notice) =>
      EditingNotice.guards.Bulk(notice) && BulkView.guards.Idle(notice.view)
  );

  const dispatchRoot = Effect.fn("dispatchBulkRoot")(function* dispatchRoot(
    message: Parameters<typeof update>[1]
  ) {
    const result = update(yield* Ref.get(state), message);
    yield* Ref.set(state, result.model);

    for (const command of result.commands ?? []) {
      if (command.name === "DispatchEditing") {
        const args = yield* Schema.decodeUnknownEffect(EditingArgs)(
          command.args
        );

        yield* runtime.dispatch(args.personId, args.command);
      }
    }
  });

  return {
    ...fixture,
    created,
    deleted,
    dispatchRoot,
    gate,
    queue,
    read,
    retire: Scope.close(connectionScope, Exit.void),
    runtime,
    state,
  };
});

it.effect.prop(
  "bulk root histories run each selected member once, retain partial provider outcomes and ignore repeat submits while the actor owns a pending batch",
  {
    history: Schema.Array(Schema.Literals(["submit", "clear"])).check(
      Schema.isMaxLength(10)
    ),
    operation: Schema.Literals(["duplicate", "delete"]),
    rejectBeta: Schema.Boolean,
  },
  ({ history, operation, rejectBeta }) =>
    Effect.gen(function* bulkHistory() {
      const h = yield* harness({ earlyDeleteFailure: false, rejectBeta });

      const action =
        operation === "delete"
          ? EditorAction.cases.DeleteSelected.make({})
          : EditorAction.cases.DuplicateSelected.make({});

      yield* h.dispatchRoot(
        Message.EditingAction({ action, personId: h.personId })
      );
      yield* nextNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Bulk(notice) &&
          BulkView.guards.Running(notice.view)
      );
      const plan = bulkPlanFor(yield* Ref.get(h.state), operation);

      for (const command of history) {
        yield* h.runtime.dispatch(
          h.personId,
          command === "submit"
            ? EditingCommand.cases.Bulk.make({ plan, selection: h.keys })
            : EditingCommand.cases.ClearBulk.make({})
        );
      }

      yield* Deferred.succeed(h.gate, true);
      yield* nextNotice(h.queue, isSettled);
      const model = yield* Ref.get(h.state);
      const summary = bulkSummary(model);

      expect(h.read).toEqual([
        "bulk-0",
        "bulk-1",
        ...(operation === "duplicate" ? ["bulk-2"] : []),
      ]);
      expect(summary?.skipped.map(({ title }) => title)).toEqual(
        operation === "delete" ? ["Gamma"] : []
      );
      expect(h.deleted).toEqual([]);

      if (operation === "duplicate") {
        expect(h.created).toHaveLength(3);
        expect(summary?.failed.map(({ title }) => title)).toEqual(
          rejectBeta ? ["Beta"] : []
        );
        expect(summary?.succeeded).toHaveLength(rejectBeta ? 2 : 3);
        expect(summary?.undo).toEqual([]);
        expect(summary?.undoUnavailable).toHaveLength(rejectBeta ? 2 : 3);

        for (const [index, request] of h.created.entries()) {
          expect(request.sendUpdates).toBe("none");
          expect(request.recurrence).toEqual([]);
          expect(request.start).toEqual(h.events[index]?.start);
          expect(request.end).toEqual(h.events[index]?.end);
        }
      } else {
        expect(h.created).toEqual([]);
        expect(summary?.succeeded).toHaveLength(2);
        expect(summary?.undo).toHaveLength(2);
        yield* h.dispatchRoot(
          Message.BulkControl({ control: "undo", personId: h.personId })
        );
        yield* nextNotice(h.queue, isUndone);
        yield* nextNotice(h.queue, isUndone);
        const restored = yield* Ref.get(h.state);

        expect(restored.calendar.selected).toEqual(h.keys);
        expect(restored.editing.deletes).toEqual([]);
        expect(restored.editing.bulk._tag).toBe("Idle");
        yield* TestClock.adjust(9000);
        expect(h.deleted).toEqual([]);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect.each(["delete", "duplicate"] satisfies ("delete" | "duplicate")[])(
  "recurring bulk %s reaches only the selected instance without mounting the recurring chooser",
  (operation) =>
    Effect.gen(function* recurringBulk() {
      const h = yield* harness({
        earlyDeleteFailure: false,
        recurring: true,
        rejectBeta: false,
      });

      yield* Deferred.succeed(h.gate, true);

      const action =
        operation === "delete"
          ? EditorAction.cases.DeleteSelected.make({})
          : EditorAction.cases.DuplicateSelected.make({});

      yield* h.dispatchRoot(
        Message.EditingAction({ action, personId: h.personId })
      );
      yield* nextNotice(h.queue, isSettled);
      const model = yield* Ref.get(h.state);

      expect(h.read).toContain("bulk-series");
      expect(model.editing.view._tag).toBe("Closed");

      if (!BulkView.guards.Settled(model.editing.bulk)) {
        return yield* Effect.die("Missing recurring bulk completion.");
      }

      for (const mutation of model.editing.bulk.execution.mutations) {
        if (EditorMutation.guards.Saved(mutation)) {
          expect(mutation.plan.scope).toBe("single");
          expect(mutation.plan.fields.recurrence).toEqual([]);
          expect(mutation.plan.sendUpdates).toBe("none");
        } else {
          expect(mutation.intent.request.scope).toBe("single");
          expect(mutation.intent.request.sendUpdates).toBe("none");
        }
      }

      return yield* Effect.void;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect(
  "committed deletions cannot be advertised as pending group Undo or restored by another group action",
  () =>
    Effect.gen(function* expiredGroupUndo() {
      const h = yield* harness({
        earlyDeleteFailure: false,
        rejectBeta: false,
      });

      yield* Deferred.succeed(h.gate, true);
      yield* h.dispatchRoot(
        Message.EditingAction({
          action: EditorAction.cases.DeleteSelected.make({}),
          personId: h.personId,
        })
      );
      yield* nextNotice(h.queue, isSettled);
      yield* TestClock.adjust(8000);
      yield* nextNotice(h.queue, committed);
      yield* nextNotice(h.queue, committed);
      const before = yield* Ref.get(h.state);

      expect(bulkSummary(before)?.undo).toEqual([]);
      expect(
        bulkSummary(before)?.undoUnavailable.map(({ title }) => title)
      ).toEqual(["Alpha", "Beta"]);
      yield* h.dispatchRoot(
        Message.BulkControl({ control: "undo", personId: h.personId })
      );
      const after = yield* Ref.get(h.state);

      expect(after.calendar.selected).toEqual(before.calendar.selected);
      expect(h.deleted).toEqual(["bulk-0", "bulk-1"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect(
  "retiring the person-scoped connection cancels a blocked member and cannot write later members after logout",
  () =>
    Effect.gen(function* retireBulk() {
      const h = yield* harness({
        earlyDeleteFailure: false,
        rejectBeta: false,
      });

      yield* h.dispatchRoot(
        Message.EditingAction({
          action: EditorAction.cases.DuplicateSelected.make({}),
          personId: h.personId,
        })
      );
      yield* nextNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Bulk(notice) &&
          BulkView.guards.Running(notice.view)
      );
      yield* h.retire;
      const writesAtRetirement = [...h.created];
      yield* Deferred.succeed(h.gate, true);
      yield* Effect.yieldNow;

      expect(h.created).toEqual(writesAtRetirement);
      expect(h.created.every(({ title }) => title === "Alpha")).toBe(true);
      expect(h.deleted).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);

it.effect(
  "a staged member can fail before a slow batch finishes; final receipts neither hide Google's failure nor resurrect a failed deletion mark",
  () =>
    Effect.gen(function* earlyFailure() {
      const h = yield* harness({ earlyDeleteFailure: true, rejectBeta: false });
      yield* h.dispatchRoot(
        Message.EditingAction({
          action: EditorAction.cases.DeleteSelected.make({}),
          personId: h.personId,
        })
      );
      yield* nextNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Delete(notice) &&
          DeleteNotice.guards.Changed(notice.notice) &&
          notice.notice.intent.title === "Alpha"
      );
      yield* TestClock.adjust(8000);
      yield* nextNotice(
        h.queue,
        (notice) =>
          EditingNotice.guards.Delete(notice) &&
          DeleteNotice.guards.Settled(notice.notice) &&
          notice.notice.intent.title === "Alpha"
      );
      yield* Deferred.succeed(h.gate, true);
      yield* nextNotice(h.queue, isSettled);
      const model = yield* Ref.get(h.state);
      const summary = bulkSummary(model);

      expect(summary?.failed.map(({ title }) => title)).toEqual(["Alpha"]);
      expect(summary?.failed[0]?.reason).toContain(
        "Google rejected Alpha cancellation."
      );
      expect(model.editing.deletes.map(({ intent }) => intent.title)).toEqual([
        "Beta",
      ]);
      expect(summary?.undo).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
