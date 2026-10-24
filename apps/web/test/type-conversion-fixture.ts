import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, send, waitFor } from "@xstate/effect";
import { Effect, Option } from "effect";

import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import { eventEditorMachine } from "../src/client/editing/editor-machine.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";
import { editorCalendars, editorOriginal } from "./editor-fixture.js";

const forbiddenWrite = Effect.die(
  new Error("Draft conversion must not write remotely")
);

export const conversionRequest = () =>
  EditorRequest.cases.New.make({
    allDay: false,
    calendars: editorCalendars,
    endDate: "2026-10-19",
    endTime: "10:00",
    navigation: initialNavigation(dayFromIso("2026-10-19")),
    primaryZone: "America/Los_Angeles",
    ref: { accountId: "work", calendarId: "primary" },
    selection: Option.none(),
    startDate: "2026-10-19",
    startTime: "09:30",
  });

export const conversionActor = Effect.fn("Conversion.makeActor")(
  function* conversionActor(
    request: typeof EditorRequest.Type = conversionRequest(),
    allowCreate?: boolean,
    machine: typeof eventEditorMachine = eventEditorMachine
  ) {
    const deletion = yield* DeletionSession.make().pipe(
      Effect.provideService(
        DeletionWriter,
        DeletionWriter.of({ commit: () => forbiddenWrite })
      )
    );

    const actor = yield* createEffectActor(machine).pipe(
      Effect.provideService(DeletionSession, deletion),
      Effect.provideService(
        CalendarEditingClient,
        CalendarEditingClient.of({
          createEvent: (input) =>
            allowCreate === true
              ? Effect.succeed({
                  ...editorOriginal,
                  ...input.event,
                  eventId: input.id,
                })
              : forbiddenWrite,
          deleteEvent: () => forbiddenWrite,
          getEvent: () =>
            Effect.succeed(
              EditorRequest.guards.Existing(request)
                ? request.event
                : editorOriginal
            ),
          moveAndRetimeSeries: () => forbiddenWrite,
          moveEvent: () => forbiddenWrite,
          moveSupport: "notAvailable",
          rsvp: () => forbiddenWrite,
          updateEvent: () => forbiddenWrite,
        })
      )
    );

    yield* watchActor("calendar.conversion.test", actor);
    yield* send(actor, { request, type: "OPEN" });
    yield* waitFor(actor, (snapshot) => snapshot.matches("editing")).pipe(
      Effect.orDie
    );

    return actor;
  }
);
