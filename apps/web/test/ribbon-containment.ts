interface Bounds {
  readonly bottom: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
}

interface RibbonMeasurement {
  readonly chip: Bounds | null;
  readonly kind: "all-day" | "timed";
  readonly ribbon: Bounds;
  readonly within: boolean;
}

interface RibbonContainment {
  readonly allDay: number;
  readonly measurements: readonly RibbonMeasurement[];
  readonly passed: boolean;
  readonly timed: number;
}

export const measureRibbonContainment = (root: Document): RibbonContainment => {
  const measurements = [
    ...root.querySelectorAll<HTMLElement>(".calendar-ribbon"),
  ].map((ribbon): RibbonMeasurement => {
    const box = ribbon.getBoundingClientRect();
    const chip = ribbon.closest(".event-chip")?.getBoundingClientRect();

    return {
      chip:
        chip === undefined
          ? null
          : {
              bottom: chip.bottom,
              height: chip.height,
              left: chip.left,
              right: chip.right,
              top: chip.top,
              width: chip.width,
            },
      kind: ribbon.closest(".all-day") === null ? "timed" : "all-day",
      ribbon: {
        bottom: box.bottom,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        width: box.width,
      },
      within:
        chip !== undefined &&
        box.width > 0 &&
        box.height > 0 &&
        box.left >= chip.left &&
        box.top >= chip.top &&
        box.right <= chip.right &&
        box.bottom <= chip.bottom,
    };
  });

  const timed = measurements.filter(
    (measurement) => measurement.kind === "timed"
  ).length;

  const allDay = measurements.filter(
    (measurement) => measurement.kind === "all-day"
  ).length;

  return {
    allDay,
    measurements,
    passed:
      timed > 0 &&
      allDay > 0 &&
      measurements.every((measurement) => measurement.within),
    timed,
  };
};
