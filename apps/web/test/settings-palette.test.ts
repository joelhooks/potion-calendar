import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";

import { eventPalette } from "../src/layout/colors.js";
import { chipColors } from "../src/layout/settings-colors.js";

const luminance = (value: string): number => {
  const hex =
    value.length === 4
      ? `#${value
          .slice(1)
          .split("")
          .map((channel) => `${channel}${channel}`)
          .join("")}`
      : value;

  const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(
    (part) => {
      const channel = Number.parseInt(part, 16) / 255;

      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    }
  );

  return (
    (channels[0] ?? 0) * 0.2126 +
    (channels[1] ?? 0) * 0.7152 +
    (channels[2] ?? 0) * 0.0722
  );
};

const contrast = (first: string, second: string): number => {
  const a = luminance(first);
  const b = luminance(second);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

it.effect(
  "menu and help text, disabled entries and key hints meet AA against real theme tokens",
  () =>
    Effect.gen(function* menuContrast() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const root =
        /:root\s*\{(?<tokens>[^}]+)\}/u.exec(css)?.groups?.tokens ?? "";

      const dark =
        /\.app\.theme-dark\s*\{(?<tokens>[^}]+)\}/u.exec(css)?.groups?.tokens ??
        "";

      for (const [name, block] of [
        ["light", root],
        ["dark", dark],
      ]) {
        const token = (key: string) => {
          const value = block?.match(
            new RegExp(`--${key}:\\s*(#[\\da-f]{3,6})`, "iu")
          )?.[1];

          expect(value, `${name} ${key}`).toBeDefined();

          return value ?? "#000000";
        };

        for (const foreground of ["text", "muted"]) {
          for (const background of ["surface", "surface-subtle", "pressed"]) {
            expect(
              contrast(token(foreground), token(background)),
              `${name} ${foreground}/${background}`
            ).toBeGreaterThanOrEqual(4.5);
          }
        }

        expect(
          contrast(token("on-primary"), token("primary"))
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(token("focus"), token("surface"))
        ).toBeGreaterThanOrEqual(3);
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.each(["light", "dark"] as const)(
  "every named palette has AA chip text contrast in %s, including hover and selection",
  (theme) =>
    Effect.sync(() => {
      for (const entry of eventPalette) {
        const colors = chipColors(entry.hex, theme);

        for (const fill of [
          colors.fill,
          colors.selectedFill,
          theme === "dark" ? "#171c19" : "#ffffff",
        ]) {
          expect(
            contrast(colors.text, fill),
            `${theme} ${entry.name} ${fill}`
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    })
);

it.effect.prop(
  "arbitrary provider calendar colours preserve AA contrast in both themes",
  {
    color: Schema.Int.check(
      Schema.isBetween({ maximum: 0xff_ff_ff, minimum: 0 })
    ),
  },
  ({ color }) =>
    Effect.sync(() => {
      const hex = `#${color.toString(16).padStart(6, "0")}`;

      for (const theme of ["light", "dark"] as const) {
        const colors = chipColors(hex, theme);
        expect(contrast(colors.text, colors.fill)).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(colors.text, colors.selectedFill)
        ).toBeGreaterThanOrEqual(4.5);
        expect(chipColors(hex, "light").fill).not.toBe(
          chipColors(hex, "dark").fill
        );
      }
    })
);
