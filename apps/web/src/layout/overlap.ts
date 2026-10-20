export interface TimedInterval {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly selected?: boolean;
}

export interface TimedPlacement {
  readonly id: string;
  readonly lane: number;
  readonly lanes: number;
  readonly left: number;
  readonly width: number;
  readonly paint: number;
}

const endOf = (event: TimedInterval): number =>
  Math.max(event.end, event.start + 1 / 60);

export const collides = (a: TimedInterval, b: TimedInterval): boolean =>
  a.start < endOf(b) && b.start < endOf(a);

const compare = (a: TimedInterval, b: TimedInterval): number =>
  a.start - b.start || endOf(b) - endOf(a) || a.id.localeCompare(b.id);

const placeGroup = (group: readonly TimedInterval[]): TimedPlacement[] => {
  const lanes: TimedInterval[][] = [];

  const assigned = group.map((event) => {
    let lane = lanes.findIndex((items) =>
      items.every((item) => !collides(item, event))
    );

    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
    }

    lanes[lane]?.push(event);

    return { event, lane };
  });

  const count = lanes.length;
  const placed: { event: TimedInterval; placement: TimedPlacement }[] = [];

  for (const { event, lane } of assigned) {
    let rightLane = lane + 1;

    while (
      rightLane < count &&
      lanes[rightLane]?.every((item) => !collides(item, event)) === true
    ) {
      rightLane += 1;
    }

    let right = rightLane;

    for (let next = rightLane; next < count; next += 1) {
      const conflicts =
        lanes[next]?.filter((item) => collides(item, event)) ?? [];

      right += conflicts.some((item) => item.start - event.start <= 30)
        ? 0.5
        : 1;
    }

    right = Math.min(count, right) / count;
    let left = lane / count;

    for (let previous = lane - 1; previous >= 0; previous -= 1) {
      const conflicts =
        lanes[previous]?.filter((item) => collides(item, event)) ?? [];

      if (conflicts.length === 0) {
        continue;
      }

      const [conflict] = conflicts;
      const prior = placed.find((item) => item.event.id === conflict?.id);

      if (
        conflicts.length === 1 &&
        prior &&
        (event.start - prior.event.start > 30 ||
          prior.placement.left < previous / count)
      ) {
        left = Math.min(left, prior.placement.left + 0.05);
      }

      break;
    }

    placed.push({
      event,
      placement: {
        id: event.id,
        lane,
        lanes: count,
        left,
        paint: lane + (event.selected === true ? count : 0),
        width: right - left,
      },
    });
  }

  return placed.map(({ placement }) => placement);
};

export const layoutTimed = (
  events: readonly TimedInterval[]
): readonly TimedPlacement[] => {
  const ordered = events.toSorted(compare);
  const groups: TimedInterval[][] = [];
  let latestEnd = Number.NEGATIVE_INFINITY;

  for (const event of ordered) {
    if (event.start >= latestEnd) {
      groups.push([]);
      latestEnd = endOf(event);
    } else {
      latestEnd = Math.max(latestEnd, endOf(event));
    }

    groups.at(-1)?.push(event);
  }

  return groups.flatMap(placeGroup);
};
