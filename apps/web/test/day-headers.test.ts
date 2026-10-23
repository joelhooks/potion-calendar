import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { dayHeaderForm, dayHeaderLabel } from "../src/layout/day-header.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { dayLabel } from "../src/layout/presentation.js";

it.effect.prop(
  "computed widths choose the specified form without changing the date or full accessible name",
  {
    offset: Schema.Int.check(Schema.isBetween({ maximum: 365, minimum: 0 })),
    width: Schema.Int.check(Schema.isBetween({ maximum: 2048, minimum: 16 })),
  },
  ({ offset, width }) =>
    Effect.sync(() => {
      const day = dayFromIso("2026-01-01") + offset;
      const label = dayHeaderLabel(day, width);
      const number = dayLabel(day, { day: "numeric" });

      let expected = { form: "number", text: number };

      if (width >= 32) {
        expected = {
          form: "initial",
          text: `${number} ${dayLabel(day, { weekday: "narrow" })}`,
        };
      }

      if (width >= 56) {
        expected = {
          form: "full",
          text: dayLabel(day, { day: "numeric", weekday: "short" }),
        };
      }

      expect({ form: label.form, text: label.text }).toEqual(expected);
      expect(label.ariaLabel).toBe(dayLabel(day, { dateStyle: "full" }));
    })
);

it.effect.each([
  [16, "number"],
  [31, "number"],
  [32, "initial"],
  [55, "initial"],
  [56, "full"],
] as const)("width %s uses the inclusive %s boundary", ([width, form]) =>
  Effect.sync(() => {
    expect(dayHeaderForm(width)).toBe(form);
  })
);
