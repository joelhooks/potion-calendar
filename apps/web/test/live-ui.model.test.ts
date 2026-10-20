import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Message, update } from "../src/client/app.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import { fixtureSelection } from "./fixture.js";

it.effect(
  "live notices reread visible ranges without syncing, ignore hidden calendars and reject a previous person's socket",
  () =>
    Effect.sync(() => {
      const model = fixtureSelection();

      const visible = LiveNotice.cases.CalendarChanged.make({
        change: {
          accountId: "work",
          calendarId: "primary",
          reason: "sync",
          version: 1,
        },
      });

      const received = update(
        model,
        Message.ReceivedLive({ notice: visible, personId: "fixture-person" })
      );

      expect(
        received.commands?.every((command) => command.name === "ReadEvents")
      ).toBe(true);
      expect(received.model.calendar.rangeRequest).toBe(
        model.calendar.rangeRequest + 1
      );

      const stale = update(
        model,
        Message.ReceivedLive({ notice: visible, personId: "previous-person" })
      );

      expect(stale.model).toBe(model);
      expect(stale.commands).toBeUndefined();

      const hidden = LiveNotice.cases.CalendarChanged.make({
        change: {
          accountId: "work",
          calendarId: "hidden",
          reason: "sync",
          version: 1,
        },
      });

      expect(
        update(
          model,
          Message.ReceivedLive({ notice: hidden, personId: "fixture-person" })
        ).model
      ).toBe(model);
    })
);

it.effect.each([
  LiveNotice.cases.Reconnected.make({}),
  LiveNotice.cases.InventoryChanged.make({}),
])(
  "%s reloads inventory before ranges; only explicit refresh syncs",
  (notice) =>
    Effect.sync(() => {
      const model = fixtureSelection();

      const inventory = update(
        model,
        Message.ReceivedLive({ notice, personId: "fixture-person" })
      );

      expect(inventory.commands?.map((command) => command.name)).toEqual([
        "ReadCalendars",
      ]);
      const manual = update(model, Message.ClickedRefresh());
      expect(manual.commands?.length).toBeGreaterThan(0);
      expect(
        manual.commands?.every((command) => command.name === "RefreshEvents")
      ).toBe(true);

      const key = update(
        model,
        Message.PressedCalendarKey({
          alt: false,
          key: "r",
          mod: false,
          shift: false,
        })
      );

      expect(key.commands?.map((command) => command.name)).toEqual(
        manual.commands?.map((command) => command.name)
      );
    })
);
