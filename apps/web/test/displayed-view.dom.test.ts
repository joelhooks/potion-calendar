import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureSelection } from "./fixture.js";

for (const [mode, expected] of [
  ["week", "Week · 7 days"],
  ["day", "Day · 1 day"],
  ["days", "19 days"],
  ["month", "Month"],
] as const) {
  it.effect(
    `Displayed view reports ${mode} rather than a retained custom day count`,
    () =>
      Effect.gen(function* displayedView() {
        const base = fixtureSelection();

        const model = {
          ...base,
          calendar: {
            ...base.calendar,
            navigation: { ...base.calendar.navigation, days: 19, mode },
          },
          route: SettingsRoute.make({ page: "general" }),
        };

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        const row = [...document.querySelectorAll(".settings-row")].find(
          (item) => item.firstElementChild?.textContent === "Displayed view"
        );

        expect(row?.lastElementChild?.textContent).toBe(
          `${expected}. Change this on the calendar.`
        );
      })
  );
}

it.effect.prop(
  "custom Displayed view reports the active custom count",
  { days: Schema.Int.check(Schema.isBetween({ maximum: 31, minimum: 1 })) },
  ({ days }) =>
    Effect.gen(function* customCount() {
      const base = fixtureSelection();

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: {
            ...base.calendar.navigation,
            days,
            mode: "days" as const,
          },
        },
        route: SettingsRoute.make({ page: "general" }),
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const row = [...document.querySelectorAll(".settings-row")].find(
        (item) => item.firstElementChild?.textContent === "Displayed view"
      );

      expect(row?.lastElementChild?.textContent).toBe(
        `${days} days. Change this on the calendar.`
      );
    })
);

it.effect(
  "the transient phone Day is reported as one day without saving preferences",
  () =>
    Effect.gen(function* phoneDay() {
      const base = fixtureSelection();
      const preferences = preferenceSnapshot(base);

      const opened = update(
        base,
        Message.MeasuredShellViewport({ width: 390 })
      );

      const routed = update(
        opened.model,
        Message.RequestedRoute({
          replace: false,
          route: SettingsRoute.make({ page: "general" }),
        })
      );

      const rendered = yield* renderToString(
        { init: () => ({ model: routed.model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const row = [...document.querySelectorAll(".settings-row")].find(
        (item) => item.firstElementChild?.textContent === "Displayed view"
      );

      expect(base.calendar.navigation.days).toBe(7);
      expect(routed.model.calendar.navigation.mode).toBe("day");
      expect(routed.model.calendar.navigation.days).toBe(1);
      expect(row?.lastElementChild?.textContent).toBe(
        "Day · 1 day. Change this on the calendar."
      );
      expect(preferenceSnapshot(routed.model)).toEqual(preferences);
      expect(
        [...(opened.commands ?? []), ...(routed.commands ?? [])].some(
          (command) => command.name === "SavePreferences"
        )
      ).toBe(false);
    })
);
