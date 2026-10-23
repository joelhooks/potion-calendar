import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { gridZones, phoneSwipeKey } from "../src/client/phone-grid/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { TimeZoneAction } from "../src/client/time-zones/model.js";
import { zoneDragHostKey } from "../src/client/zone-drag/host.js";
import { visibleDays } from "../src/layout/navigation.js";
import { fixtureSelection } from "./fixture.js";
import { phoneGridFixture, phoneGridScenes } from "./phone-grid-fixture.js";

it.effect.prop(
  "the first phone viewport chooses Day without saving preferences, and a user view survives later measurements",
  {
    mode: Schema.Literals(["day", "week", "month"]),
    width: Schema.Int.check(Schema.isBetween({ maximum: 640, minimum: 320 })),
  },
  ({ width, mode }) =>
    Effect.sync(() => {
      const base = fixtureSelection();
      const preferences = preferenceSnapshot(base);
      const opened = update(base, Message.MeasuredShellViewport({ width }));
      expect(opened.model.calendar.navigation.mode).toBe("day");
      expect(visibleDays(opened.model.calendar.navigation)).toHaveLength(1);
      expect(
        opened.commands?.some(
          (command) => command.name === "SavePreferences"
        ) ?? false
      ).toBe(false);
      expect(preferenceSnapshot(opened.model)).toEqual(preferences);

      const picked = update(
        opened.model,
        Message.ClickedView({ days: 7, mode })
      );

      const resized = update(
        picked.model,
        Message.MeasuredShellViewport({ width: width === 640 ? 390 : 640 })
      );

      expect(resized.model.calendar.navigation).toEqual(
        picked.model.calendar.navigation
      );
      expect(resized.commands ?? []).toHaveLength(0);
      expect(
        picked.commands?.some(
          (command) => command.name === "SavePreferences"
        ) ?? false
      ).toBe(false);
      expect(preferenceSnapshot(resized.model)).toEqual(preferences);
    })
);

it.effect(
  "641 px stays desktop and 640 px applies the phone default exactly once",
  () =>
    Effect.sync(() => {
      const base = fixtureSelection();

      const desktop = update(
        base,
        Message.MeasuredShellViewport({ width: 641 })
      ).model;

      expect(desktop.calendar.navigation).toEqual(base.calendar.navigation);
      expect(desktop.phoneGrid.defaultView).toBe("pending");

      const phone = update(
        desktop,
        Message.MeasuredShellViewport({ width: 640 })
      ).model;

      expect(phone.calendar.navigation.mode).toBe("day");
      expect(phone.phoneGrid.defaultView).toBe("settled");

      const picked = update(
        phone,
        Message.ClickedView({ days: 7, mode: "month" })
      ).model;

      const wide = update(
        picked,
        Message.MeasuredShellViewport({ width: 1440 })
      ).model;

      const returned = update(
        wide,
        Message.MeasuredShellViewport({ width: 390 })
      ).model;

      expect(returned.calendar.navigation).toEqual(picked.calendar.navigation);
    })
);

it.effect(
  "phone zones hide saved secondaries without changing their order or preference snapshot",
  () =>
    Effect.sync(() => {
      for (const scene of phoneGridScenes.filter(
        (item) => item.scene === "day" || item.scene === "travel"
      )) {
        const model = phoneGridFixture(scene);
        const saved = model.timeZones.preferences;

        const expected = [
          saved.primary,
          ...Option.toArray(model.timeZones.temporary),
        ];

        expect(gridZones(model)).toEqual(expected);
        expect(saved.secondary).toHaveLength(3);
        expect(preferenceSnapshot(model).zones).toEqual(saved);

        const desktop = {
          ...model,
          phoneShell: { ...model.phoneShell, viewportWidth: 1440 },
        };

        expect(gridZones(desktop)).toEqual([...saved.secondary, ...expected]);
      }
    })
);

it.effect(
  "entering the phone layout cancels a desktop zone drag and rejects its queued drop without saving",
  () =>
    Effect.sync(() => {
      const base = phoneGridFixture(phoneGridScenes[0]);

      const id =
        base.timeZones.preferences.secondary[0]?.id ??
        base.timeZones.preferences.primary.id;

      const desktop = {
        ...base,
        phoneShell: { ...base.phoneShell, viewportWidth: 1440 },
        timeZones: { ...base.timeZones, drag: Option.some({ id, index: 2 }) },
      };

      const hostKey = Option.getOrThrow(zoneDragHostKey(desktop));

      const phone = update(
        desktop,
        Message.MeasuredShellViewport({ width: 390 })
      ).model;

      expect(Option.isNone(phone.timeZones.drag)).toBe(true);

      const dropped = update(
        phone,
        Message.TimeZoneAction({
          action: TimeZoneAction.cases.MoveTo.make({ hostKey, id, index: 2 }),
        })
      );

      expect(dropped.model.timeZones.preferences).toEqual(
        desktop.timeZones.preferences
      );

      expect(
        dropped.commands?.some(
          (command) => command.name === "SavePreferences"
        ) ?? false
      ).toBe(false);
    })
);

it.effect(
  "swipe messages reach existing period navigation once and reject stale people, periods and open sheets",
  () =>
    Effect.sync(() => {
      const model = phoneGridFixture(phoneGridScenes[0]);
      const hostKey = Option.getOrThrow(phoneSwipeKey(model));
      const personId = Option.getOrThrow(model.person);

      const message = Message.PhoneSwipedPeriod({
        direction: 1,
        hostKey,
        personId,
      });

      const expected = update(model, Message.ClickedPage({ direction: 1 }));
      const actual = update(model, message);
      expect(actual.model.calendar.navigation).toEqual(
        expected.model.calendar.navigation
      );
      expect(actual.commands?.map((command) => command.name)).toEqual(
        expected.commands?.map((command) => command.name)
      );
      expect(update(actual.model, message).model.calendar.navigation).toEqual(
        actual.model.calendar.navigation
      );
      expect(
        update(
          model,
          Message.PhoneSwipedPeriod({
            direction: 1,
            hostKey,
            personId: "another-person",
          })
        ).model
      ).toEqual(model);

      const sheet = update(
        model,
        Message.PhoneShellOpened({ mode: "upcoming" })
      ).model;

      expect(update(sheet, message).model.calendar.navigation).toEqual(
        sheet.calendar.navigation
      );

      const desktop = {
        ...model,
        phoneShell: { ...model.phoneShell, viewportWidth: 1440 },
      };

      expect(update(desktop, message).model.calendar.navigation).toEqual(
        desktop.calendar.navigation
      );
    })
);
