import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, send, waitFor } from "@xstate/effect";
import { Crypto, Effect, Ref } from "effect";

import type { AppModel } from "../src/client/app.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import { eventEditorMachine } from "../src/client/editing/editor-machine.js";
import type { EditorView } from "../src/client/editing/editor-model.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { editorOriginal, editorCalendars } from "./editor-fixture.js";
import { fixtureModel } from "./fixture.js";
import { conversionRequest } from "./type-conversion-fixture.js";

export const commandTypeFixture = (
  view: typeof EditorView.Type,
  theme: AppModel["settings"]["theme"] = "light"
): AppModel => {
  const base = fixtureModel();

  return {
    ...base,
    calendar: { ...base.calendar, calendars: editorCalendars },
    editing: { ...base.editing, owner: base.person, view },
    keyboard: { ...base.keyboard, screen: "commands" },
    settings: { ...base.settings, theme },
  };
};

export const noProviderWrites = (
  requests: readonly { readonly method: string }[]
) =>
  requests.filter((request) =>
    ["POST", "PATCH", "DELETE"].includes(request.method)
  );

export const commandTypeActor = Effect.fn("commandTypeActor")(
  function* commandTypeActor(
    request: typeof EditorRequest.Type = conversionRequest(),
    machine: typeof eventEditorMachine = eventEditorMachine
  ) {
    const writes = yield* Ref.make<readonly string[]>([]);

    const forbidden = (method: string) =>
      Ref.update(writes, (previous) => [...previous, method]).pipe(
        Effect.andThen(
          Effect.die(
            new Error(`Unexpected ${method} during local type conversion`)
          )
        )
      );

    const deletion = yield* DeletionSession.make().pipe(
      Effect.provideService(DeletionWriter, {
        commit: () => forbidden("DELETE"),
      })
    );

    let sequence = 0;

    const actor = yield* createEffectActor(machine).pipe(
      Effect.provideService(DeletionSession, deletion),
      Effect.provideService(
        Crypto.Crypto,
        Crypto.make({
          digest: () => Effect.die(new Error("Unexpected command type digest")),
          randomBytes: (size) => {
            sequence += 1;

            return new Uint8Array(size).fill(sequence);
          },
        })
      ),
      Effect.provideService(CalendarEditingClient, {
        createEvent: () => forbidden("POST"),
        deleteEvent: () => forbidden("DELETE"),
        getEvent: () =>
          Effect.succeed(
            EditorRequest.guards.Existing(request)
              ? request.event
              : editorOriginal
          ),
        moveAndRetimeSeries: () => forbidden("PATCH"),
        moveEvent: () => forbidden("POST"),
        moveSupport: "notAvailable",
        rsvp: () => forbidden("PATCH"),
        updateEvent: () => forbidden("PATCH"),
      })
    );

    yield* watchActor("calendar.command-type.test", actor);
    yield* send(actor, { request, type: "OPEN" });
    yield* waitFor(actor, (snapshot) => snapshot.matches("editing")).pipe(
      Effect.orDie
    );

    return { actor, writes };
  }
);
