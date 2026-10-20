import {
  Calendar,
  CalendarEvent,
  Provider,
} from "@calendar/calendar/contracts";
import type { CreateEventInput } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Crypto, Effect, Option, Stream } from "effect";

import { clipboardMachine } from "../src/client/clipboard/machine.js";
import type { ClipboardSnapshot } from "../src/client/clipboard/machine.js";
import {
  ClipboardAnchor,
  ClipboardEnvelope,
  ClipboardPasteTarget,
  NativeClipboardNotice,
} from "../src/client/clipboard/model.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { clipboardItem } from "./clipboard-fixture.js";

export const clipboardTarget = ClipboardPasteTarget.make({
  calendar: Calendar.make({
    accessRole: "owner",
    accountId: "work",
    calendarId: "primary",
    primary: true,
    timeZone: "America/Los_Angeles",
    title: "Work",
  }),
  navigation: initialNavigation(dayFromIso("2026-10-19")),
  primaryZone: "America/Los_Angeles",
  selection: Option.none(),
});

export const clipboardPoint = ClipboardAnchor.cases.Timed.make({
  date: "2026-10-19",
  instant: 1_792_429_200_000,
});

export const copiedFact = (
  sequence: number,
  mode: "copy" | "cut",
  personId = "person-A",
  sessionId = "native-fixture"
) =>
  NativeClipboardNotice.cases.Copied.make({
    envelope: ClipboardEnvelope.make({
      id: `${sessionId}.${sequence}`,
      items: [clipboardItem()],
      personId,
      version: 1,
    }),
    mode,
    personId,
    sequence,
    sessionId,
  });

export const pasteFact = (
  sequence: number,
  copyId: string,
  sessionId = "native-fixture"
) =>
  NativeClipboardNotice.cases.Paste.make({
    anchor: clipboardPoint,
    copyId,
    personId: "person-A",
    sequence,
    sessionId,
    target: clipboardTarget,
  });

export const clipboardClient = (failures: number) => {
  const calls: (typeof CreateEventInput.Type)[] = [];

  const client = CalendarEditingClient.of({
    createEvent: (input) =>
      Effect.gen(function* createClipboardEvent() {
        calls.push(input);

        if (calls.length <= failures) {
          return yield* new Provider({
            message: "Synthetic create refusal",
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
    deleteEvent: () =>
      Effect.die("Clipboard actor must delegate Cut, not delete"),
    getEvent: () => Effect.die("Paste must not reread a Cut original"),
    moveAndRetimeSeries: () => Effect.die("Unexpected series move"),
    moveEvent: () => Effect.die("Unexpected move"),
    moveSupport: "notAvailable",
    rsvp: () => Effect.die("Unexpected RSVP"),
    updateEvent: () => Effect.die("Unexpected update"),
  });

  return { calls, client };
};

export const waitClipboard = (
  actor: EffectActor<typeof clipboardMachine>,
  predicate: (snapshot: ClipboardSnapshot) => boolean
) =>
  snapshots(actor).pipe(
    Stream.filter(
      (snapshot) => snapshot.status === "error" || predicate(snapshot)
    ),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
    Effect.filterOrElse(
      (snapshot) => snapshot.status !== "error",
      (snapshot) => Effect.die(snapshot.error)
    )
  );

export const clipboardHarness = Effect.fn("test.clipboardHarness")(
  function* clipboardHarness(failures: number) {
    const memory = clipboardClient(failures);

    const deletion = yield* DeletionSession.make().pipe(
      Effect.provideService(
        DeletionWriter,
        DeletionWriter.of({
          commit: () => Effect.die("Clipboard must not delete directly"),
        })
      )
    );

    const crypto = yield* Crypto.Crypto;

    const actor = yield* createEffectActor(clipboardMachine, {
      input: { personId: "person-A" },
    }).pipe(
      Effect.provideService(CalendarEditingClient, memory.client),
      Effect.provideService(Crypto.Crypto, crypto),
      Effect.provideService(DeletionSession, deletion)
    );

    yield* watchActor("calendar.clipboard.test", actor);
    yield* send(actor, { sessionId: "native-fixture", type: "ATTACH_NATIVE" });
    yield* waitClipboard(
      actor,
      (snapshot) => snapshot.context.nativeSessionId === "native-fixture"
    );

    return { ...memory, actor };
  }
);
