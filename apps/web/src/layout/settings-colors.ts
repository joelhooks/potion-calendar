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

const linear = (channel: number): number => {
  const value = channel / 255;

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const color = rgb(hex);

  return (
    linear(color.red) * 0.2126 +
    linear(color.green) * 0.7152 +
    linear(color.blue) * 0.0722
  );
};

const aaShade = (
  color: typeof Rgb.Type,
  toward: typeof Rgb.Type,
  background: string,
  fallback: string
): string => {
  const surface = luminance(background);

  for (let weight = 255; weight >= 0; weight -= 1) {
    const shade = blend(color, toward, weight / 255);
    const value = luminance(shade);

    const contrast =
      (Math.max(value, surface) + 0.05) / (Math.min(value, surface) + 0.05);

    if (contrast >= 4.5) {
      return shade;
    }
  }

  return fallback;
};

export const chipColors = (hex: string, theme: "light" | "dark") => {
  const color = rgb(hex);
  const dark = theme === "dark";

  const base = dark
    ? { blue: 20, green: 23, red: 16 }
    : { blue: 255, green: 255, red: 255 };

  const white = { blue: 255, green: 255, red: 255 };
  const black = { blue: 0, green: 0, red: 0 };
  const text = dark ? "#edf5f0" : "#17251e";

  const accent = blend(
    color,
    dark ? white : { blue: 32, green: 45, red: 35 },
    dark ? 0.72 : 0.78
  );

  return {
    accent,
    border: blend(color, base, 0.6),
    fill: blend(color, base, dark ? 0.22 : 0.18),
    selectedFill: blend(color, base, dark ? 0.3 : 0.32),
    selectedPrimaryFill: aaShade(color, black, "#ffffff", "#000000"),
    statusText: aaShade(
      rgb(accent),
      dark ? white : black,
      dark ? "#171c19" : "#ffffff",
      text
    ),
    text,
  };
};
