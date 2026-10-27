import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Match, Schema } from "effect";

import { menuAgenda } from "../src/agenda.js";
import { NativeIntent } from "../src/native-host.js";
import type { NativeIntentValue } from "../src/native-host.js";
import { trayResponseMenu } from "../src/tray-response.js";

const event: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: null,
  end: 20_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "instance" },
  responseStatus: "accepted",
  start: 10_000,
  title: "Saved meeting",
};

it.effect.prop(
  "tray labels, exact checkmarks and callbacks follow only actual self response",
  {
    enabled: Arbitrary.schema(Schema.Boolean),
    response: Arbitrary.schema(
      Schema.NullOr(
        Schema.Literals(["accepted", "declined", "tentative", "needsAction"])
      )
    ),
  },
  ({ response, enabled }) =>
    Effect.sync(() => {
      const intents: NativeIntentValue[] = [];

      const menu = trayResponseMenu(
        { ...event, rsvp: { enabled, response } },
        (intent) => {
          intents.push(intent);
        }
      );

      expect(menu).toHaveLength(1);
      const [parent] = menu;
      expect(parent?.id).toBe("tray-respond");
      expect(parent?.label).toBe(
        response === null || response === "needsAction"
          ? "Respond"
          : "Update response"
      );
      expect(parent?.enabled).toBe(enabled);

      const rows =
        parent?.submenu?.filter(
          (row) => row.id?.startsWith("tray-response-") === true
        ) ?? [];

      expect(rows.map((row) => [row.id, row.label, row.accelerator])).toEqual([
        ["tray-response-yes", "Yes", "Y"],
        ["tray-response-no", "No", "N"],
        ["tray-response-maybe", "Maybe", "M"],
      ]);
      expect(
        rows.filter((row) => row.checked === true).map((row) => row.label)
      ).toEqual(
        Match.value(response).pipe(
          Match.when("accepted", () => ["Yes"]),
          Match.when("declined", () => ["No"]),
          Match.when("tentative", () => ["Maybe"]),
          Match.orElse(() => [])
        )
      );
      expect(
        rows.every((row) => row.enabled === enabled && row.type === "checkbox")
      ).toBe(true);

      for (const row of rows) {
        row.click?.();
      }

      expect(intents).toEqual([
        NativeIntent.cases.RespondToEvent.make({
          key: event.key,
          response: "accepted",
        }),
        NativeIntent.cases.RespondToEvent.make({
          key: event.key,
          response: "declined",
        }),
        NativeIntent.cases.RespondToEvent.make({
          key: event.key,
          response: "tentative",
        }),
      ]);
    })
);

it.effect(
  "no target or no self-response eligibility exposes no response submenu",
  () =>
    Effect.sync(() => {
      expect(trayResponseMenu(undefined, () => {})).toEqual([]);
      expect(trayResponseMenu(event, () => {})).toEqual([]);
    })
);

it.effect(
  "the first filtered menu target is independent of title and time preview preferences",
  () =>
    Effect.sync(() => {
      const snapshot = {
        events: [
          { ...event, end: 500, key: { ...event.key, eventId: "ended" } },
          {
            ...event,
            key: { ...event.key, eventId: "target" },
            rsvp: { enabled: true, response: null },
          },
          {
            ...event,
            end: 40_000,
            key: { ...event.key, eventId: "later" },
            rsvp: { enabled: true, response: null },
            start: 30_000,
          },
        ],
      };

      for (const preview of [true, false]) {
        const agenda = menuAgenda(
          snapshot,
          {
            ...defaultDesktopPreferences(),
            showTime: preview,
            showTitle: preview,
          },
          1000
        );

        expect(agenda[0]?.key.eventId).toBe("target");
        expect(
          trayResponseMenu(agenda[0], () => {})[0]
            ?.submenu?.filter(
              (row) => row.id?.startsWith("tray-response-") === true
            )
            .map((row) => row.accelerator)
        ).toEqual(["Y", "N", "M"]);
      }
    })
);
