import { Schema } from "effect";

export const WindowBounds = Schema.Struct({
  height: Schema.Int.check(Schema.isGreaterThan(0)),
  width: Schema.Int.check(Schema.isGreaterThan(0)),
  x: Schema.Int,
  y: Schema.Int,
});

export type WindowGeometry = typeof WindowBounds.Type;

export const clampWindow = (
  saved: WindowGeometry,
  displays: readonly WindowGeometry[]
): WindowGeometry => {
  const display = displays.find(
    (area) =>
      saved.x < area.x + area.width &&
      saved.x + saved.width > area.x &&
      saved.y < area.y + area.height &&
      saved.y + saved.height > area.y
  ) ??
    displays[0] ?? { height: 800, width: 1200, x: 0, y: 0 };

  const width = Math.min(saved.width, display.width);
  const height = Math.min(saved.height, display.height);

  return {
    height,
    width,
    x: Math.max(
      display.x,
      Math.min(saved.x, display.x + display.width - width)
    ),
    y: Math.max(
      display.y,
      Math.min(saved.y, display.y + display.height - height)
    ),
  };
};
