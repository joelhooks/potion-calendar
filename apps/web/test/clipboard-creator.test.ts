import { CalendarEvent, Provider } from "@calendar/calendar/contracts";
import type { CreateEventInput } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import {
  Crypto,
  DateTime,
  Deferred,
  Effect,
  Option,
  Schema,
  Stream,
} from "effect";

import {
  clipboardCreatorMachine,
  ClipboardCreatorOutcome,
} from "../src/client/clipboard/creator-machine.js";
import type { ClipboardCreatorSnapshot } from "../src/client/clipboard/creator-machine.js";
import { ClipboardAnchor } from "../src/client/clipboard/model.js";
import { placeClipboardItem } from "../src/client/clipboard/placement.js";
import { prepareClipboardTemplate } from "../src/client/clipboard/template.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { loadEditor } from "../src/client/editing/load-editor.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { writeEditor } from "../src/client/editing/write-editor.js";
import { initialNavigation, dayFromIso } from "../src/layout/navigation.js";
import { clipboardItem, clipboardSource } from "./clipboard-fixture.js";
import { editorCalendars } from "./editor-fixture.js";

type CreatorActor = EffectActor<typeof clipboardCreatorMachine>;

const settle = (actor: CreatorActor, consumed?: ClipboardCreatorSnapshot) =>
  snapshots(actor).pipe(
    Stream.filter(
      (snapshot) =>
        snapshot !== consumed &&
        (snapshot.status === "error" ||
          snapshot.status === "done" ||
          snapshot.matches({ active: "failed" }) ||
          snapshot.matches({ active: "refused" }))
    ),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
    Effect.filterOrElse(
      (snapshot) => snapshot.status !== "error",
      (snapshot) => Effect.die(snapshot.error)
    )
  );

const requestFor = Effect.fn("test.clipboardCreateRequest")(
  function* requestFor(guests: boolean) {
    const item = clipboardItem();

    const placed = yield* placeClipboardItem(
      item,
      ClipboardAnchor.cases.Timed.make({
        date: "2026-10-19",
        instant: DateTime.toEpochMillis(
          DateTime.makeUnsafe("2026-10-19T17:00:00.000Z")
        ),
      }),
      "America/Los_Angeles"
    );

    const template = yield* prepareClipboardTemplate(
      item,
      "paste-intent",
      guests ? "includeAndEmail" : "exclude"
    );

    return EditorRequest.cases.New.make({
      ...placed,
      calendars: editorCalendars,
      navigation: initialNavigation(dayFromIso("2026-10-19")),
      primaryZone: "America/Los_Angeles",
      ref: { accountId: "work", calendarId: "primary" },
      selection: Option.none(),
      template,
    });
  }
);

const harness = Effect.fn("test.clipboardCreatorHarness")(function* harness(
  request: typeof EditorRequest.cases.New.Type,
  failures: number,
  pending?: Deferred.Deferred<void>
) {
  const calls: (typeof CreateEventInput.Type)[] = [];

  const deletion = yield* DeletionSession.make().pipe(
    Effect.provideService(
      DeletionWriter,
      DeletionWriter.of({
        commit: () => Effect.die("Clipboard creation must never delete"),
      })
    )
  );

  const client = CalendarEditingClient.of({
    createEvent: (input) =>
      Effect.gen(function* create() {
        calls.push(input);

        if (pending !== undefined) {
          yield* Deferred.await(pending);
        }

        if (calls.length <= failures) {
          return yield* new Provider({
            message: "Synthetic create failure",
            operation: "createEvent",
            status: 503,
          });
        }

        return CalendarEvent.make({
          ...input.event,
          accountId: input.accountId,
          calendarId: input.calendarId,
          eventId: input.id,
          status: "confirmed",
        });
      }),
    deleteEvent: () => Effect.die("Unexpected delete"),
    getEvent: () => Effect.die("Paste must not reread a possibly Cut original"),
    moveAndRetimeSeries: () => Effect.die("Unexpected series move"),
    moveEvent: () => Effect.die("Unexpected move"),
    moveSupport: "notAvailable",
    rsvp: () => Effect.die("Unexpected RSVP"),
    updateEvent: () => Effect.die("Unexpected update"),
  });

  const crypto = yield* Crypto.Crypto;

  const actor = yield* createEffectActor(clipboardCreatorMachine, {
    input: { request },
  }).pipe(
    Effect.provideService(CalendarEditingClient, client),
    Effect.provideService(DeletionSession, deletion),
    Effect.provideService(Crypto.Crypto, crypto)
  );

  yield* watchActor("calendar.clipboard.creator.test", actor);

  return { actor, calls, client };
});

it.effect(
  "private clipboard creation reuses normal planning/writing and preserves source false flags and placement, with no original-event read",
  () =>
    Effect.gen(function* directPaste() {
      const h = yield* harness(yield* requestFor(false), 0);
      const done = yield* settle(h.actor);
      expect(done.status).toBe("done");
      expect(
        ClipboardCreatorOutcome.guards.Saved(
          Option.getOrThrow(Option.fromUndefinedOr(done.output))
        )
      ).toBe(true);
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0]).toMatchObject({
        event: {
          attendees: [],
          end: {
            dateTime: "2026-10-19T18:30:00.000Z",
            timeZone: "America/Los_Angeles",
          },
          guestsCanInviteOthers: false,
          guestsCanModify: false,
          guestsCanSeeOtherGuests: false,
          recurrence: [],
          start: {
            dateTime: "2026-10-19T17:00:00.000Z",
            timeZone: "America/Los_Angeles",
          },
          title: clipboardSource.title,
          transparency: "transparent",
          visibility: "private",
        },
        sendUpdates: "none",
      });
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "explicit guest inclusion drives the existing email action once, without a second user decision",
  () =>
    Effect.gen(function* includeGuests() {
      const h = yield* harness(yield* requestFor(true), 0);
      const done = yield* settle(h.actor);
      expect(done.status).toBe("done");
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0]).toMatchObject({
        event: {
          attendees: [
            { email: "alex@example.test", responseStatus: "needsAction" },
          ],
        },
        sendUpdates: "all",
      });
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "an ordinary Create still sends all three default guest permissions true",
  () =>
    Effect.gen(function* ordinaryCreate() {
      const source = yield* requestFor(false);

      const ordinary = EditorRequest.cases.New.make({
        allDay: source.allDay,
        calendars: source.calendars,
        endDate: source.endDate,
        endTime: source.endTime,
        navigation: source.navigation,
        primaryZone: source.primaryZone,
        ref: source.ref,
        selection: source.selection,
        startDate: source.startDate,
        startTime: source.startTime,
      });

      const h = yield* harness(source, 0);
      yield* settle(h.actor);

      const session = yield* loadEditor(ordinary).pipe(
        Effect.provideService(CalendarEditingClient, h.client)
      );

      const plan = yield* prepareEditor(session);
      yield* writeEditor(plan).pipe(
        Effect.provideService(CalendarEditingClient, h.client),
        Effect.provideService(
          DeletionSession,
          yield* DeletionSession.make().pipe(
            Effect.provideService(
              DeletionWriter,
              DeletionWriter.of({
                commit: () => Effect.die("Unexpected deletion"),
              })
            )
          )
        )
      );
      expect(h.calls.at(-1)).toMatchObject({
        event: {
          guestsCanInviteOthers: true,
          guestsCanModify: true,
          guestsCanSeeOtherGuests: true,
        },
      });
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "explicit retry histories keep the original child and creation identity, without automatic replay",
  {
    failures: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(3)
    ),
    guests: Schema.Boolean,
  },
  ({ failures, guests }) =>
    Effect.gen(function* stableRetry() {
      const h = yield* harness(yield* requestFor(guests), failures);
      let consumed: ClipboardCreatorSnapshot | undefined;

      for (let attempt = 0; attempt <= failures; attempt += 1) {
        const result = yield* settle(h.actor, consumed);
        expect(h.calls).toHaveLength(attempt + 1);

        if (attempt < failures) {
          expect(result.matches({ active: "failed" })).toBe(true);
          consumed = result;
          yield* send(h.actor, { type: "RETRY" });
        } else {
          expect(result.status).toBe("done");
        }
      }

      expect(new Set(h.calls.map((call) => call.id)).size).toBe(1);
      expect(
        h.calls.every((call) => call.sendUpdates === (guests ? "all" : "none"))
      ).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer))
);
