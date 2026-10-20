import { timeColumns } from "./geometry.js";

export const zoneColumns = (available: number, days: number, count: number) => {
  const extra = Math.max(0, count - 1) * 46;
  const base = timeColumns(available, days);

  return {
    ...base,
    template:
      count === 1
        ? base.template
        : `repeat(${count}, 46px) repeat(${days}, ${base.day}px)`,
    total: base.total + extra,
  };
};
