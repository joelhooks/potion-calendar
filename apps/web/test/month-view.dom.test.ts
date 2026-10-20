import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { monthGrid } from "../src/features/month-grid.js";
import { MonthWindowFrame } from "../src/layout/month-window.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { fixtureModel } from "./fixture.js";

const render = (model: AppModel, frame?: typeof MonthWindowFrame.Type) =>
  renderToString(
    {
      init: () => ({ model }),
      view: (current: AppModel, h: HtmlBuilder<AppMessage>) => ({
        body: monthGrid(current, h, frame),
        title: "Month fixture",
      }),
    },
    { isHydratable: false }
  );

it.effect(
  "a rolling month renders eighteen rows plus at most one parked focus week with stable date attributes",
  () =>
    Effect.gen(function* rollingMonth() {
      const model = fixtureModel();
      const firstWeek = dayFromIso("2026-09-06");

      for (const pinned of [
        Option.none<number>(),
        Option.some(firstWeek + 7),
        Option.some(firstWeek - 7),
      ]) {
        const frame = MonthWindowFrame.make({
          firstWeek,
          pinnedWeek: pinned,
          revision: 0,
        });

        const document = new DOMParser().parseFromString(
          (yield* render(model, frame)).html,
          "text/html"
        );

        const viewport = document.querySelector<HTMLElement>("#month-viewport");
        expect(viewport?.dataset.monthFirstWeek).toBe(String(firstWeek));
        const parked = Option.contains(pinned, firstWeek - 7);
        expect(viewport?.querySelectorAll(".month-week")).toHaveLength(
          parked ? 19 : 18
        );
        expect(viewport?.querySelectorAll("[data-month-parked]")).toHaveLength(
          parked ? 1 : 0
        );
        expect(
          viewport?.querySelectorAll(
            ".month-week:not([data-month-parked]) .month-cell[data-day]"
          )
        ).toHaveLength(126);

        if (parked) {
          expect(
            viewport?.querySelector<HTMLElement>(
              "[data-month-parked] .month-cell"
            )?.dataset.day
          ).toBe(String(firstWeek - 7));
        }
      }
    })
);

it.effect(
  "month has a dedicated week gutter outside date buttons and compact timed items retain their clock and shared selection control",
  () =>
    Effect.gen(function* compactMonth() {
      const base = fixtureModel();

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: { ...base.calendar.navigation, mode: "month" as const },
        },
        settings: { ...base.settings, showWeekNumbers: true },
      };

      const document = new DOMParser().parseFromString(
        (yield* render(model)).html,
        "text/html"
      );

      expect(document.querySelectorAll(".month-week")).toHaveLength(6);
      expect(document.querySelectorAll(".month-week-number")).toHaveLength(6);
      expect(
        document.querySelectorAll(".month-date .week-number")
      ).toHaveLength(0);
      expect(
        document.querySelector<HTMLElement>(".month-week")?.style
          .gridTemplateColumns
      ).toBe("24px repeat(7, minmax(0, 1fr))");

      const event = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".month-item-timed .event-chip"
        ),
      ].find((button) => button.textContent?.includes("Product review"));

      expect(event?.querySelector(".event-time")?.textContent).toBe("9am");
      expect(event?.dataset.eventKey).toBeTruthy();
      expect(event?.getAttribute("aria-label")).toContain("Product review");
      expect(
        event?.querySelectorAll(".calendar-ribbon").length
      ).toBeGreaterThan(0);
      expect(
        document.querySelector(".month-item-all-day .event-chip")
      ).not.toBeNull();
    })
);

it.effect(
  "a multi-day event renders one chip per touched week rather than a copy in each covered date cell",
  () =>
    Effect.gen(function* spanningMonth() {
      const base = fixtureModel();

      const event = CalendarEvent.make({
        accountId: "work",
        calendarId: "primary",
        end: { date: "2026-10-27" },
        eventId: "cross-week",
        start: { date: "2026-10-23" },
        status: "confirmed",
        title: "Across the week boundary",
      });

      for (const hidden of [false, true]) {
        const model = {
          ...base,
          calendar: {
            ...base.calendar,
            navigation: {
              ...base.calendar.navigation,
              hideWeekends: hidden,
              mode: "month" as const,
            },
            reads: base.calendar.reads.map((read) => ({
              ...read,
              events: RemoteEvents.Success({
                data: {
                  events: read.accountId === "work" ? [event] : [],
                  versions: [],
                },
              }),
            })),
          },
        };

        const document = new DOMParser().parseFromString(
          (yield* render(model)).html,
          "text/html"
        );

        const bars = [...document.querySelectorAll<HTMLElement>(".month-span")];
        expect(bars).toHaveLength(2);
        expect(
          bars.map(
            (bar) =>
              Number(bar.dataset.endColumn) - Number(bar.dataset.startColumn)
          )
        ).toEqual(hidden ? [1, 1] : [2, 2]);
        expect(
          document.querySelectorAll(".month-cell .month-item-all-day")
        ).toHaveLength(0);
        expect(
          document.querySelectorAll(".month-span .event-chip")
        ).toHaveLength(2);
      }
    })
);

it.effect(
  "hidden weekends retain six aligned rows without a gutter, including disabled cells at the navigation limit",
  () =>
    Effect.gen(function* monthBoundaries() {
      const base = fixtureModel();

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: {
            ...base.calendar.navigation,
            anchor: dayFromIso("2015-01-01"),
            hideWeekends: true,
            mode: "month" as const,
          },
        },
      };

      const document = new DOMParser().parseFromString(
        (yield* render(model)).html,
        "text/html"
      );

      expect(document.querySelectorAll(".month-week-number")).toHaveLength(0);
      expect(document.querySelectorAll(".month-cell")).toHaveLength(30);
      expect(document.querySelectorAll(".month-cell-unavailable")).toHaveLength(
        3
      );
      const first = document.querySelector(".month-date");
      expect(first?.textContent).toBe("1");
      expect(first?.getAttribute("aria-label")).toBe(
        "Thursday, January 1, 2015"
      );
    })
);
