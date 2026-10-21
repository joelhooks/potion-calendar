import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send, waitFor } from "@xstate/effect";
import { Effect, Option, Ref } from "effect";
import { FetchHttpClient } from "effect/http";

import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { rsvpMachine } from "../src/client/editing/rsvp-machine.js";
import {
  keyboardRegistry,
  selectedEvent,
} from "../src/client/keyboard/registry.js";
import {
  captureShortcutCommands,
  pressEditorShortcut,
} from "./editor-shortcut-fixture.js";
import { savedStatusFixture } from "./status-fidelity-fixture.js";

const omittedKeys = [
  ["j", "edit-add-meet"],
  ["k", "edit-links"],
  ["e", "email-participants"],
  ["l", "edit-location"],
  ["w", "edit-description"],
  ["p", "edit-participantEmail"],
  ["a", "edit-allDay"],
] as const;

it.effect.each(["focusTime", "outOfOffice"] as const)(
  "saved %s omitted-section sequences stay inert and command rows stay disabled",
  (type) =>
    Effect.gen(function* omittedStatusKeys() {
      const f = yield* savedStatusFixture({ mode: "declineNone", type });
      const model = yield* Ref.get(f.state);
      expect(selectedEvent(model)?.source.eventType).toBe(type);
      expect(f.calendar.accessRole).toBe("owner");

      for (const [key, id] of omittedKeys) {
        expect(
          keyboardRegistry.find((row) => row.id === id)?.availability(model)
        ).toBe("disabled");
        const result = pressEditorShortcut(model, key);
        expect(yield* captureShortcutCommands(result)).toHaveLength(0);
        expect(result.model.calendar.navigation).toBe(
          model.calendar.navigation
        );
        expect(result.model.calendar.selected).toEqual(model.calendar.selected);
      }

      for (const id of ["rsvp-yes", "rsvp-no", "rsvp-maybe"]) {
        expect(
          keyboardRegistry.find((row) => row.id === id)?.availability(model)
        ).toBe("disabled");
      }
    })
);

it.effect.each(["focusTime", "outOfOffice"] as const)(
  "the RSVP actor also refuses an injected %s response despite a self attendee in the source",
  (type) =>
    Effect.gen(function* statusRsvpActor() {
      const f = yield* savedStatusFixture({ mode: "declineNone", type });
      expect(f.source.attendees?.some((person) => person.self === true)).toBe(
        true
      );

      const actor = yield* createEffectActor(rsvpMachine).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, f.api.fetcher)
      );

      yield* watchActor("calendar.status-rsvp.test", actor);
      yield* send(actor, { event: Option.some(f.source), type: "FOCUS" });
      yield* send(actor, { response: "accepted", type: "CHOOSE" });
      yield* send(actor, { note: "status-choice-barrier", type: "NOTE" });

      const snapshot = yield* waitFor(
        actor,
        (current) => current.context.note === "status-choice-barrier"
      ).pipe(Effect.orDie);

      expect(snapshot.matches("idle")).toBe(true);
      expect(snapshot.context.intent).toBeUndefined();
      expect(
        (yield* Ref.get(f.api.fake.receipts)).filter(
          (receipt) => receipt.request.method === "PATCH"
        )
      ).toHaveLength(0);
    })
);
