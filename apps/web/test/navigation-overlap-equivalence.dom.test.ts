import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";

import type { AppMessage, AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { timeGrid } from "../src/features/time-grid.js";
import { dayFromIso, midnightInZone } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureEvents, fixtureModel } from "./fixture.js";

const overlapView = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: timeGrid(model, h),
  title: "Overlap geometry",
});

const stylesFor = Effect.fnUntraced(function* stylesFor(model: AppModel) {
  const rendered = yield* renderToString(
    { init: () => ({ model }), view: overlapView },
    { isHydratable: false }
  );

  const document = new DOMParser().parseFromString(rendered.html, "text/html");

  return [...document.querySelectorAll<HTMLElement>(".day-column .event-chip")]
    .map((chip) => ({
      day: Number(chip.closest<HTMLElement>(".day-column")?.dataset.day),
      left: chip.style.left,
      paint: Number(chip.style.zIndex),
      selected: chip.classList.contains("selected"),
      title: chip.querySelector("strong")?.textContent,
      width: chip.style.width,
    }))
    .toSorted((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
});

const overlapPropertyTiming = {
  budgetMillis: 15_000,
  fullSuiteObservedMillis: 5853,
  standaloneInvocationMillis: 4670,
};

it.effect.prop(
  "every visible hidden-weekday column retains seven-day overlap percentages and paint; selection affects only paint",
  {
    hidden: Schema.UniqueArray(
      Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 }))
    ).check(Schema.isMaxLength(6)),
    intervals: Schema.Array(
      Schema.Struct({
        duration: Schema.Int.check(
          Schema.isBetween({ maximum: 180, minimum: 60 })
        ),
        offset: Schema.Int.check(Schema.isBetween({ maximum: 29, minimum: 0 })),
        selected: Schema.Boolean,
      })
    ).check(Schema.isMinLength(2), Schema.isMaxLength(6)),
  },
  ({ hidden, intervals }) =>
    Effect.gen(function* overlapEquivalence() {
      const base = fixtureModel();
      const [first] = fixtureEvents;
      const template = yield* Effect.fromNullishOr(first);

      const days = Array.from({ length: 7 }, (_, weekday) => weekday).filter(
        (weekday) => !hidden.includes(weekday)
      );

      const start = dayFromIso("2026-10-18");

      const events = days.flatMap((weekday) =>
        intervals.map((interval, index) => {
          const midnight = DateTime.makeUnsafe(
            midnightInZone(start + weekday, base.calendar.zone)
          );

          return {
            ...template,
            end: {
              dateTime: DateTime.formatIso(
                DateTime.add(midnight, {
                  minutes: 540 + interval.offset + interval.duration,
                })
              ),
            },
            eventId: `overlap-${weekday}-${index}`,
            start: {
              dateTime: DateTime.formatIso(
                DateTime.add(midnight, { minutes: 540 + interval.offset })
              ),
            },
            title: `Lane ${weekday}-${index}`,
          };
        })
      );

      const original: AppModel = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: { ...base.calendar.navigation, anchor: start },
          reads: [
            {
              accountId: "work",
              events: RemoteEvents.Success({ data: { events, versions: [] } }),
            },
          ],
        },
        settings: { ...base.settings, hideContextPanel: true },
      };

      const selected = visibleEvents(original)
        .filter(
          (event) =>
            intervals[Number(event.source.eventId.split("-").at(-1))]
              ?.selected === true
        )
        .map((event) => event.key);

      const full = {
        ...original,
        calendar: { ...original.calendar, selected },
      };

      const filtered = {
        ...full,
        calendar: {
          ...full.calendar,
          navigation: { ...full.calendar.navigation, hiddenWeekdays: hidden },
        },
      };

      const seven = yield* stylesFor(full);
      const hiddenColumns = yield* stylesFor(filtered);
      const unselected = yield* stylesFor(original);
      expect(hiddenColumns).toEqual(seven);
      expect(hiddenColumns).toHaveLength(days.length * intervals.length);
      expect(hiddenColumns.map(({ left, width }) => ({ left, width }))).toEqual(
        unselected.map(({ left, width }) => ({ left, width }))
      );
      expect(
        hiddenColumns.every(
          (chip, index) =>
            chip.paint ===
            (unselected[index]?.paint ?? 0) +
              (chip.selected ? intervals.length : 0)
        )
      ).toBe(true);
    }),
  {
    arbitrary: { runs: 20 },
    timeout: overlapPropertyTiming.budgetMillis,
  }
);
