import { expect, it } from "@effect/vitest";
import { Effect, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";

import {
  DeleteOutcome,
  DeletionWriter,
} from "../src/client/editing/delete-actor.js";
import type {
  DeleteCommit,
  DeleteIntentValue,
} from "../src/client/editing/delete-actor.js";
import {
  DeleteCommand,
  DeleteNotice,
  DeletionSession,
} from "../src/client/editing/deletion-session.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { editorOriginal } from "./editor-fixture.js";

const intent = (id: string, eventId: string): DeleteIntentValue => ({
  event: { ...editorOriginal, eventId },
  id,
  navigation: initialNavigation(dayFromIso("2026-10-19")),
  request: {
    accountId: "work",
    calendarId: "primary",
    eventId,
    scope: "single",
    sendUpdates: "none",
  },
  selection: Option.none(),
  title: editorOriginal.title ?? "Event",
});

const harness = Effect.fn("deletionSessionHarness")(
  function* deletionSessionHarness() {
    const calls: (typeof DeleteCommit.Type)[] = [];

    const writer = DeletionWriter.of({
      commit: (input) =>
        Effect.sync(() => {
          calls.push(input);
        }),
    });

    const session = yield* DeletionSession.make().pipe(
      Effect.provideService(DeletionWriter, writer)
    );

    const stream = yield* session.subscribe;

    const notices = yield* stream.pipe(
      Stream.toQueue({ capacity: "unbounded" })
    );

    return { calls, notices, session };
  }
);

it.effect(
  "the session owns two independent actors and Undo targets only the requested intent",
  () =>
    Effect.gen(function* independentDeleteSession() {
      const h = yield* harness();
      const first = intent("first", "first-event");
      const second = intent("second", "second-event");
      yield* h.session.dispatch(
        DeleteCommand.cases.Begin.make({ intent: first })
      );
      yield* h.session.dispatch(
        DeleteCommand.cases.Begin.make({ intent: second })
      );

      const pending = [
        yield* Queue.take(h.notices),
        yield* Queue.take(h.notices),
      ];

      expect(new Set(pending.map((notice) => notice.intent.id))).toEqual(
        new Set(["first", "second"])
      );
      yield* h.session.dispatch(
        DeleteCommand.cases.Undo.make({ id: "second" })
      );
      expect(yield* Queue.take(h.notices)).toEqual(
        DeleteNotice.cases.Settled.make({
          intent: second,
          outcome: DeleteOutcome.cases.Undone.make({ id: "second" }),
        })
      );
      yield* TestClock.adjust(7999);
      expect(h.calls).toHaveLength(0);
      yield* TestClock.adjust(1);
      const committing = yield* Queue.take(h.notices);
      expect(committing).toEqual(
        DeleteNotice.cases.Changed.make({
          intent: first,
          keepalive: false,
          phase: "committing",
        })
      );
      expect(yield* Queue.take(h.notices)).toEqual(
        DeleteNotice.cases.Settled.make({
          intent: first,
          outcome: DeleteOutcome.cases.Committed.make({ id: "first" }),
        })
      );
      expect(h.calls).toEqual([{ keepalive: false, request: first.request }]);
    })
);

it.effect(
  "duplicate queued staging never creates a second timer for the same event reference",
  () =>
    Effect.gen(function* duplicateDeleteStaging() {
      const h = yield* harness();
      const first = intent("first", "same-event");
      yield* h.session.dispatch(
        DeleteCommand.cases.Begin.make({ intent: first })
      );
      yield* h.session.dispatch(
        DeleteCommand.cases.Begin.make({
          intent: intent("duplicate", "same-event"),
        })
      );
      yield* Queue.take(h.notices);
      yield* h.session.dispatch(
        DeleteCommand.cases.Dismiss.make({ id: "first" })
      );
      expect(yield* Queue.take(h.notices)).toEqual(
        DeleteNotice.cases.Changed.make({
          intent: first,
          keepalive: false,
          phase: "committing",
        })
      );
      expect(yield* Queue.take(h.notices)).toEqual(
        DeleteNotice.cases.Settled.make({
          intent: first,
          outcome: DeleteOutcome.cases.Committed.make({ id: "first" }),
        })
      );
      yield* TestClock.adjust(16_000);
      expect(h.calls).toHaveLength(1);
    })
);

it.effect(
  "leaving the session commits every pending deletion with keepalive",
  () =>
    Effect.gen(function* leaveDeleteSession() {
      const h = yield* harness();
      yield* h.session.dispatch(
        DeleteCommand.cases.Begin.make({
          intent: intent("first", "first-event"),
        })
      );
      yield* h.session.dispatch(
        DeleteCommand.cases.Begin.make({
          intent: intent("second", "second-event"),
        })
      );
      yield* Queue.take(h.notices);
      yield* Queue.take(h.notices);
      yield* h.session.dispatch(DeleteCommand.cases.Leaving.make({}));
      const seen = [];

      for (let index = 0; index < 4; index += 1) {
        seen.push(yield* Queue.take(h.notices));
      }

      expect(seen.filter(DeleteNotice.guards.Settled)).toHaveLength(2);
      expect(h.calls).toHaveLength(2);
      expect(h.calls.every((call) => call.keepalive)).toBe(true);
    })
);

it.effect(
  "closing the session stops all owned actors without saving intents for another visit",
  () =>
    Effect.gen(function* closeDeleteSession() {
      const calls = yield* Effect.scoped(
        Effect.gen(function* oldSession() {
          const h = yield* harness();
          yield* h.session.dispatch(
            DeleteCommand.cases.Begin.make({
              intent: intent("abandoned", "abandoned-event"),
            })
          );
          yield* Queue.take(h.notices);

          return h.calls;
        })
      );

      yield* TestClock.adjust(16_000);
      expect(calls).toHaveLength(0);
    })
);
