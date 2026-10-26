import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import { trayAgenda } from "../src/agenda.js";
import { NativeIntent } from "../src/native-host.js";
import type { NativeIntentValue } from "../src/native-host.js";
import { trayMenuRows } from "../src/tray-menu.js";
import type { TrayMenuItem } from "../src/tray-menu.js";
import { trayEvent, trayNow, trayView } from "./tray-current-fixture.js";

const format = { day: () => "Today", time: () => "10:00" };

const flat = (items: readonly TrayMenuItem[]): readonly TrayMenuItem[] =>
  items.flatMap((item) => [item, ...flat(item.submenu ?? [])]);

it.effect.prop(
  "the tray owns one timed current event without duplicating a whole key or losing another account's same event id",
  {
    offset: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 1 }))
    ),
    reverse: Arbitrary.schema(Schema.Boolean),
  },
  ({ offset, reverse }) =>
    Effect.sync(() => {
      const current = trayEvent("same", trayNow - offset);

      const other = {
        ...trayEvent("same", trayNow + offset),
        key: { ...current.key, accountId: "other" },
      };

      const allDay = {
        ...trayEvent("all-day", trayNow - offset * 2),
        allDay: true,
      };

      const view = trayView(
        reverse ? [other, current, allDay] : [allDay, current, other]
      );

      const selected = trayAgenda(
        view.agenda,
        { ...view.preferences, includeAllDay: true },
        trayNow
      );

      expect(selected.current).toEqual(current);
      expect(selected.remaining.map((event) => event.key)).toEqual([
        allDay.key,
        other.key,
      ]);

      const rows = trayMenuRows(
        { ...view, preferences: { ...view.preferences, includeAllDay: true } },
        format,
        () => {}
      );

      expect(
        flat(rows).filter((row) => row.id === "tray-current-event")
      ).toHaveLength(1);
      expect(
        rows
          .filter((row) => row.id?.startsWith("tray-day-event-") === true)
          .map((row) => row.label)
      ).toEqual([
        "All-day  Unanswered · Saved meeting  Room 42",
        "10:00  Unanswered · Saved meeting  Room 42",
      ]);
    })
);

it.effect(
  "current boundaries, complete-key ties and the existing menu horizon are independent of preview and all-day settings",
  () =>
    Effect.sync(() => {
      const now = trayNow;
      const expired = { ...trayEvent("expired", now - 1000), end: now };
      const starting = trayEvent("same", now);
      const tied = { ...starting, key: { ...starting.key, accountId: "z" } };
      const future = trayEvent("future", now + 1);

      const far = {
        ...trayEvent("far", now + 4 * 24 * 60 * 60_000),
        end: now + 5 * 24 * 60 * 60_000,
      };

      const view = trayView([far, tied, expired, future, starting]);
      expect(trayAgenda(view.agenda, view.preferences, now).current).toEqual(
        starting
      );
      expect(
        trayAgenda({ events: [tied, starting] }, view.preferences, now).current
      ).toEqual(starting);
      expect(
        trayAgenda({ events: [starting, tied] }, view.preferences, now).current
      ).toEqual(starting);
      expect(
        trayAgenda(
          { events: [far] },
          { ...view.preferences, previewMinutes: 10_080 },
          now
        ).current
      ).toBeUndefined();
      expect(
        trayAgenda(view.agenda, { ...view.preferences, menuBar: false }, now)
          .current
      ).toBeUndefined();
      expect(
        trayMenuRows(
          trayView([{ ...starting, allDay: true }]),
          format,
          () => {}
        ).map((row) => row.id)
      ).toEqual(["tray-empty"]);
      expect(
        trayAgenda({ events: [future] }, view.preferences, now).current
      ).toEqual(future);
    })
);

it.effect(
  "the actual pure tray template has one current section, location, all new callbacks and unchanged RSVP IDs",
  () =>
    Effect.sync(() => {
      const current = trayEvent("current");
      const later = { ...trayEvent("later", trayNow + 1000), title: "Later" };
      const intents: NativeIntentValue[] = [];

      const rows = trayMenuRows(
        trayView([current, later]),
        format,
        (intent) => {
          intents.push(intent);
        }
      );

      const items = flat(rows);
      expect(rows.map((row) => row.id)).toEqual([
        "tray-current-section",
        "tray-current-event",
        "tray-current-separator",
        "tray-day-heading-0",
        "tray-day-event-0",
      ]);
      expect(rows[0]?.label).toBe("Current meeting");
      expect(rows[1]?.label).toBe("10:00  Unanswered · Saved meeting  Room 42");
      expect(items.some((row) => row.id === "tray-current-select-event")).toBe(
        false
      );

      for (const id of [
        "tray-current-join",
        "tray-current-attachment-0",
        "tray-current-attachment-1",
        "tray-current-email-participants",
        "tray-current-show-event",
      ]) {
        const item = items.find((row) => row.id === id);
        expect(item).toBeDefined();
        item?.click?.();
      }

      expect(intents.map((intent) => intent._tag)).toEqual([
        "TrayJoin",
        "TrayAttachment",
        "TrayAttachment",
        "TrayEmail",
        "TrayShowEvent",
      ]);
      expect(
        items
          .filter((row) => row.id?.startsWith("tray-response-") === true)
          .map((row) => row.id)
      ).toEqual([
        "tray-response-yes",
        "tray-response-no",
        "tray-response-maybe",
      ]);
      expect(items.find((row) => row.id === "tray-respond")?.label).toBe(
        "Respond"
      );
      expect(items.find((row) => row.id === "tray-day-join-0")).toBeDefined();
    })
);

it.effect(
  "no conferencing exposes inert copy plus Select event and old payloads do not inherit attachment or email actions",
  () =>
    Effect.sync(() => {
      const source = trayEvent("current");
      const intents: NativeIntentValue[] = [];

      const rows = trayMenuRows(
        trayView([{ ...source, conferenceUrl: null }]),
        format,
        (intent) => {
          intents.push(intent);
        }
      );

      const items = flat(rows);
      expect(
        items.find((row) => row.id === "tray-current-no-conferencing")
      ).toMatchObject({ enabled: false, label: "Meeting has no conferencing" });
      expect(
        items.find((row) => row.id === "tray-current-select-event")?.label
      ).toBe("Select event");
      expect(items.some((row) => row.id === "tray-current-join")).toBe(false);

      const select = items.find(
        (row) => row.id === "tray-current-select-event"
      );

      expect(select?.enabled).not.toBe(false);
      select?.click?.();
      expect(intents).toEqual([
        NativeIntent.cases.TrayShowEvent.make({ key: source.key }),
      ]);
      const legacy = { ...source, trayDetails: undefined };
      const old = flat(trayMenuRows(trayView([legacy]), format, () => {}));
      expect(
        old.some(
          (row) =>
            row.id === "tray-current-attachments" ||
            row.id === "tray-current-email-participants"
        )
      ).toBe(false);
      expect(
        old.find((row) => row.id === "tray-current-event")?.label
      ).not.toContain("Room 42");
    })
);
