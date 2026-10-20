import { Option, Schema } from "effect";

const HexColor = Schema.String.check(Schema.isPattern(/^#[\da-f]{6}$/iu));

const Rgb = Schema.Struct({
  blue: Schema.Finite,
  green: Schema.Finite,
  red: Schema.Finite,
});

const rgb = (value: string): typeof Rgb.Type => {
  const hex = Option.getOrElse(
    Schema.decodeOption(HexColor)(value),
    () => "#7d8d85"
  );

  return {
    blue: Number.parseInt(hex.slice(5, 7), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    red: Number.parseInt(hex.slice(1, 3), 16),
  };
};

const blend = (
  color: typeof Rgb.Type,
  base: typeof Rgb.Type,
  weight: number
): string =>
  `#${[Math.round(color.red * weight + base.red * (1 - weight)), Math.round(color.green * weight + base.green * (1 - weight)), Math.round(color.blue * weight + base.blue * (1 - weight))].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

export const chipColors = (hex: string, theme: "light" | "dark") => {
  const color = rgb(hex);
  const dark = theme === "dark";

  const base = dark
    ? { blue: 20, green: 23, red: 16 }
    : { blue: 255, green: 255, red: 255 };

  return {
    accent: blend(
      color,
      dark
        ? { blue: 255, green: 255, red: 255 }
        : { blue: 32, green: 45, red: 35 },
      dark ? 0.72 : 0.78
    ),
    border: blend(color, base, 0.6),
    fill: blend(color, base, dark ? 0.22 : 0.18),
    selectedFill: blend(color, base, dark ? 0.3 : 0.32),
    text: dark ? "#edf5f0" : "#17251e",
  };
};
