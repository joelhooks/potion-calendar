import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { packAllDay } from "../src/layout/all-day.js";
import { timeColumns } from "../src/layout/geometry.js";
import { fixtureModel } from "./fixture.js";

it.effect.prop(
  "header, all-day and timed columns share one rounded-up integer width",
  {
    days: Schema.Int,
    width: Schema.Int,
  },
  ({ days, width }) =>
    Effect.gen(function* sharedColumns() {
      const count = 1 + Math.abs(days % 9);
      const available = 100 + Math.abs(width % 1900);
      const expected = Math.max(16, Math.ceil((available - 46) / count));
      const base = fixtureModel();

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: {
            ...base.calendar.navigation,
            days: count,
            mode: "days",
          },
          viewportWidth: available,
        },
      } satisfies typeof base;

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const template = `46px repeat(${count}, ${expected}px)`;

      for (const selector of [".day-headers", ".all-day", ".time-content"]) {
        expect(
          document.querySelector<HTMLElement>(selector)?.style
            .gridTemplateColumns
        ).toBe(template);
      }

      expect(
        document.querySelector<HTMLElement>(".day-columns")?.style
          .gridTemplateColumns
      ).toBe(`repeat(${count}, ${expected}px)`);
      expect(Number.isInteger(timeColumns(available, count).day)).toBe(true);
      expect(timeColumns(available, count).total).toBe(46 + count * expected);
    }),
  { arbitrary: { runs: 40 } }
);

it.effect(
  "scrolling in an earlier all-day chip does not move a surviving chip's row",
  () =>
    Effect.sync(() => {
      const existing = { end: 12, id: "existing", start: 10 };
      const incoming = { end: 11, id: "incoming", start: 1 };

      const packed = packAllDay(
        [incoming, existing],
        new Map([["existing", 0]])
      );

      expect(packed.find((item) => item.id === "existing")?.row).toBe(0);
      expect(packed.find((item) => item.id === "incoming")?.row).toBe(1);
    })
);
