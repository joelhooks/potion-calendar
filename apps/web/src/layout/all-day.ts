export interface DaySpan {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

export interface DayPlacement extends DaySpan {
  readonly row: number;
}

const intersects = (a: DaySpan, b: DaySpan): boolean =>
  a.start < b.end && b.start < a.end;

const compare = (a: DaySpan, b: DaySpan): number =>
  a.start - b.start || b.end - a.end || a.id.localeCompare(b.id);

export const packAllDay = (
  spans: readonly DaySpan[],
  previous: ReadonlyMap<string, number> = new Map()
): readonly DayPlacement[] => {
  const ordered = spans
    .toSorted(compare)
    .toSorted(
      (a, b) => Number(previous.has(b.id)) - Number(previous.has(a.id))
    );

  const packed: DayPlacement[] = [];

  for (const span of ordered) {
    const available = (row: number): boolean =>
      packed.every((item) => item.row !== row || !intersects(span, item));

    const preferred = previous.get(span.id);
    let row = preferred !== undefined && available(preferred) ? preferred : 0;

    while (!available(row)) {
      row += 1;
    }

    packed.push({ ...span, row });
  }

  return packed.toSorted(compare);
};

export const allDayHeight = (
  rows: number,
  continues: boolean,
  expanded: boolean
): number =>
  expanded
    ? Math.min(137.5, Math.max(25, 4 + 21 * (rows + Number(continues))))
    : 25;

export const allDayCounts = (
  spans: readonly DaySpan[],
  days: readonly number[]
): readonly number[] =>
  days.map(
    (day) => spans.filter((span) => span.start <= day && day < span.end).length
  );
