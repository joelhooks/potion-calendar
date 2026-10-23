import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { eventPalette } from "../src/layout/colors.js";
import { chipColors } from "../src/layout/settings-colors.js";

const StatusColors = Schema.Struct({
  selectedPrimaryFill: Schema.optional(Schema.String),
  statusText: Schema.optional(Schema.String),
});

const luminance = (hex: string): number => {
  let result = 0;

  for (const [index, weight] of [0.2126, 0.7152, 0.0722].entries()) {
    const channel =
      Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;

    const linear =
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

    result += linear * weight;
  }

  return result;
};

export const rsvpContrast = (first: string, second: string): number => {
  const a = luminance(first);
  const b = luminance(second);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const verifyRsvpColors = (hex: string, theme: "light" | "dark") => {
  const colors = chipColors(hex, theme);
  const decoded = Schema.decodeOption(StatusColors)(colors);
  expect(Option.isSome(decoded), `${theme} ${hex} status projection`).toBe(
    true
  );
  const projected = Option.getOrThrow(decoded);

  const status = {
    selectedPrimaryFill: projected.selectedPrimaryFill ?? colors.selectedFill,
    statusText: projected.statusText ?? colors.text,
  };

  const page = theme === "dark" ? "#171c19" : "#ffffff";
  expect(
    rsvpContrast(status.statusText, page),
    `${theme} ${hex} page text`
  ).toBeGreaterThanOrEqual(4.5);
  expect(
    rsvpContrast("#ffffff", status.selectedPrimaryFill),
    `${theme} ${hex} selected white`
  ).toBeGreaterThanOrEqual(4.5);

  return status;
};

it.effect.each(["light", "dark"] as const)(
  "%s all seventeen event families keep AA page text and selected white text",
  (theme) =>
    Effect.sync(() => {
      const tones = eventPalette.map((entry) =>
        verifyRsvpColors(entry.hex, theme)
      );

      expect(
        new Set(tones.map((tone) => tone.statusText)).size
      ).toBeGreaterThan(1);
      expect(
        new Set(tones.map((tone) => tone.selectedPrimaryFill)).size
      ).toBeGreaterThan(1);
    })
);

it.effect.prop(
  "generated provider colours preserve AA page text and selected white in both themes",
  {
    color: Schema.Int.check(
      Schema.isBetween({ maximum: 0xff_ff_ff, minimum: 0 })
    ),
  },
  ({ color }) =>
    Effect.sync(() => {
      const hex = `#${color.toString(16).padStart(6, "0")}`;
      verifyRsvpColors(hex, "light");
      verifyRsvpColors(hex, "dark");
    })
);
