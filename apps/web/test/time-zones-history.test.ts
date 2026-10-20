import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  TimeZoneAction,
  displayedZones,
  initialTimeZones,
} from "../src/client/time-zones/model.js";
import { changeTimeZones } from "../src/client/time-zones/update.js";
import { displayZone } from "../src/layout/time-zones.js";

const homeId = "America/Los_Angeles";

const Zone = Schema.Literals([
  homeId,
  ...Intl.supportedValuesOf("timeZone").slice(0, 5),
]);

const Step = Schema.Struct({
  direction: Schema.Literals([-1, 1]),
  id: Zone,
  kind: Schema.Literals([
    "add",
    "hide",
    "travel",
    "home",
    "primary",
    "rename",
    "move",
  ]),
  label: Schema.String.check(Schema.isMaxLength(16)),
});

const moveInReference = (
  ids: readonly string[],
  id: string,
  direction: number
): string[] => {
  const result = [...ids];
  const index = result.indexOf(id);
  const other = index + direction;
  const adjacent = result[other];

  if (index !== -1 && adjacent !== undefined) {
    result[index] = adjacent;
    result[other] = id;
  }

  return result;
};

it.effect.prop(
  "generated zone command histories preserve independent home, ordering, labels, recents and temporary travel",
  { history: Schema.Array(Step).check(Schema.isMaxLength(35)) },
  ({ history }) =>
    Effect.sync(() => {
      let actual = initialTimeZones(homeId);
      let home = homeId;
      let secondary: string[] = [];
      let temporary: string | undefined;
      let recent: string[] = [];
      const labels = new Map<string, string>([[homeId, ""]]);

      const remember = (id: string) => {
        recent = [id, ...recent.filter((value) => value !== id)].slice(0, 5);
      };

      for (const step of history) {
        const id = new Intl.DateTimeFormat("en-US", {
          timeZone: step.id,
        }).resolvedOptions().timeZone;

        switch (step.kind) {
          case "add": {
            actual = changeTimeZones(
              actual,
              TimeZoneAction.cases.Add.make({ zone: displayZone(id) })
            );

            if (
              ![home, ...secondary, temporary].includes(id) &&
              secondary.length < 3
            ) {
              secondary.push(id);
              labels.set(id, "");
              remember(id);
            }

            break;
          }

          case "hide": {
            actual = changeTimeZones(
              actual,
              TimeZoneAction.cases.Hide.make({ id })
            );
            secondary = secondary.filter((value) => value !== id);
            break;
          }

          case "travel": {
            actual = changeTimeZones(
              actual,
              TimeZoneAction.cases.Travel.make({ zone: displayZone(id) })
            );

            if (![home, ...secondary].includes(id)) {
              temporary = id;
              labels.set(id, "");
              remember(id);
            }

            break;
          }

          case "home": {
            actual = changeTimeZones(
              actual,
              TimeZoneAction.cases.Home.make({})
            );
            temporary = undefined;
            break;
          }

          case "primary": {
            actual = changeTimeZones(
              actual,
              TimeZoneAction.cases.Primary.make({ id })
            );

            if (id !== home && [...secondary, temporary].includes(id)) {
              secondary = [...secondary, home]
                .filter((value) => value !== id)
                .slice(-3);
              home = id;

              if (temporary === id) {
                temporary = undefined;
              }

              remember(id);
            }

            break;
          }

          case "rename": {
            actual = changeTimeZones(
              actual,
              TimeZoneAction.cases.Rename.make({ id, label: step.label })
            );

            if ([home, ...secondary, temporary].includes(id)) {
              labels.set(id, step.label.trim());
            }

            break;
          }

          case "move": {
            actual = changeTimeZones(
              actual,
              TimeZoneAction.cases.Move.make({ direction: step.direction, id })
            );
            secondary = moveInReference(secondary, id, step.direction);
            break;
          }

          default: {
            throw new Error("Unhandled reference-model command");
          }
        }

        expect(actual.preferences.primary.id).toBe(home);
        expect(actual.preferences.secondary.map((zone) => zone.id)).toEqual(
          secondary
        );
        expect(Option.getOrUndefined(actual.temporary)?.id).toBe(temporary);
        expect(actual.preferences.recent).toEqual(recent);
        const shown = displayedZones(actual);
        expect(new Set(shown.map((zone) => zone.id)).size).toBe(shown.length);
        expect(actual.preferences.secondary.length).toBeLessThanOrEqual(3);

        for (const zone of shown) {
          expect(zone.label).toBe(labels.get(zone.id) ?? "");
        }
      }
    })
);
