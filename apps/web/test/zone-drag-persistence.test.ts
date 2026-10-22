import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { TimeZoneAction } from "../src/client/time-zones/model.js";
import { zoneDragHostKey } from "../src/client/zone-drag/host.js";
import { displayZone } from "../src/layout/time-zones.js";
import { timeZonesFixture } from "./time-zones-fixture.js";

const index = Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 }));

it.effect.prop(
  "any secondary destination matches adjacent Move commands and uses the same root persistence writer exactly once",
  {
    destination: index,
    origin: index,
  },
  ({ destination, origin }) =>
    Effect.sync(() => {
      const base = update(
        timeZonesFixture(true),
        Message.TimeZoneAction({
          action: TimeZoneAction.cases.Add.make({
            zone: displayZone("Asia/Kathmandu"),
          }),
        })
      ).model;

      const source = Option.getOrThrow(
        Option.fromNullishOr(base.timeZones.preferences.secondary[origin])
      );

      const expected = [...base.timeZones.preferences.secondary];
      expected.splice(origin, 1);
      expected.splice(destination, 0, source);

      const dropped = update(
        base,
        Message.TimeZoneAction({
          action: TimeZoneAction.cases.MoveTo.make({
            hostKey: Option.getOrThrow(zoneDragHostKey(base)),
            id: source.id,
            index: destination,
          }),
        })
      );

      let keyboard = base;
      const direction = origin < destination ? 1 : -1;

      for (
        let current = origin;
        current !== destination;
        current += direction
      ) {
        keyboard = update(
          keyboard,
          Message.TimeZoneAction({
            action: TimeZoneAction.cases.Move.make({
              direction,
              id: source.id,
            }),
          })
        ).model;
      }

      expect(dropped.model.timeZones.preferences.secondary).toEqual(expected);
      expect(dropped.model.timeZones.preferences).toEqual(
        keyboard.timeZones.preferences
      );
      expect(dropped.model.timeZones.preferences.primary).toEqual(
        base.timeZones.preferences.primary
      );
      expect(dropped.model.timeZones.temporary).toEqual(
        base.timeZones.temporary
      );
      expect(dropped.model.calendar.zone).toBe(base.calendar.zone);

      const saves =
        dropped.commands?.filter(
          (command) => command.name === "SavePreferences"
        ) ?? [];

      expect(saves).toHaveLength(origin === destination ? 0 : 1);

      if (origin !== destination) {
        expect(saves[0]?.args).toEqual({
          ...preferenceSnapshot(dropped.model),
          person: Option.getOrThrow(base.person),
        });
      }
    })
);
