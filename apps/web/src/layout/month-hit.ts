import { Option } from "effect";

export interface MonthCellRect {
  readonly day: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export const monthCellAt = (
  cells: readonly MonthCellRect[],
  x: number,
  y: number
): Option.Option<number> => {
  const hit = cells.find(
    (cell) =>
      x >= cell.left && x < cell.right && y >= cell.top && y < cell.bottom
  );

  if (hit !== undefined) {
    return Option.some(hit.day);
  }

  let nearest: MonthCellRect | undefined;
  let distance = Number.POSITIVE_INFINITY;

  for (const cell of cells) {
    const dx = Math.max(cell.left - x, 0, x - cell.right);
    const dy = Math.max(cell.top - y, 0, y - cell.bottom);
    const squared = dx * dx + dy * dy;

    if (squared < distance) {
      nearest = cell;
      distance = squared;
    }
  }

  return Option.fromUndefinedOr(nearest?.day);
};
