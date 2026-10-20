import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Arbitrary, Effect, Schema } from "effect";

import { startPrompt } from "../src/prompt-machine.js";

it.effect.prop(
  "independent calendar copies of a provider event remain independent prompt cards",
  {
    eventId: Arbitrary.schema(Schema.NonEmptyString),
    otherCalendar: Arbitrary.schema(Schema.Boolean),
  },
  ({ eventId, otherCalendar }) =>
    Effect.gen(function* independentCards() {
      const first: AgendaEventValue = {
        allDay: false,
        calendarColor: "#64748b",
        conferenceUrl: "https://meet.example.test/room",
        end: 3_600_000,
        hasLocation: false,
        hasParticipants: true,
        key: { accountId: "first", calendarId: "primary", eventId },
        responseStatus: "accepted",
        start: 60_000,
        title: "Shared provider event",
      };

      const second = {
        ...first,
        key: {
          ...first.key,
          accountId: otherCalendar ? "first" : "second",
          calendarId: otherCalendar ? "secondary" : "primary",
        },
      };

      const actor = yield* startPrompt(
        { close: Effect.void, present: () => Effect.void },
        {
          now: 0,
          preferences: defaultDesktopPreferences(),
          snapshot: { events: [first, second] },
        }
      );

      const visible = yield* waitFor(
        actor,
        (snapshot) => snapshot.matches("visible"),
        { timeout: "2 seconds" }
      ).pipe(Effect.orDie);

      expect(visible.context.visible).toHaveLength(2);
      yield* send(actor, { key: first.key, type: "Dismiss" });

      const remaining = yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("visible") && snapshot.context.visible.length === 1,
        { timeout: "2 seconds" }
      ).pipe(Effect.orDie);

      expect(remaining.context.visible.map((event) => event.key)).toEqual([
        second.key,
      ]);
    }).pipe(Effect.scoped)
);
