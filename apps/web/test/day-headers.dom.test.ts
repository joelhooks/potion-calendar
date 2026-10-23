import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../src/client/app.js";
import { timeGrid } from "../src/features/time-grid.js";
import { dayInZone, visibleDays } from "../src/layout/navigation.js";
import { dayLabel } from "../src/layout/presentation.js";
import { dayHeadersFixture } from "./day-headers-fixture.js";

it.effect.each([16, 31, 32, 55, 56, 140])(
  "actual renderer at %s px preserves full accessible dates and today styling",
  (width) =>
    Effect.gen(function* renderedDayHeaders() {
      const base = dayHeadersFixture(900, "light", "open");
      const days = visibleDays(base.calendar.navigation);

      const model = {
        ...base,
        calendar: { ...base.calendar, viewportWidth: 46 + days.length * width },
      };

      const rendered = yield* renderToString(
        {
          init: () => ({ model }),
          view: (value: AppModel, h: HtmlBuilder<AppMessage>) => ({
            body: timeGrid(value, h),
            title: "Day headers",
          }),
        },
        { isHydratable: false }
      );

      const parsed = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const headers = [...parsed.querySelectorAll<HTMLElement>(".day-header")];
      const today = dayInZone(model.calendar.now, model.calendar.zone);

      expect(headers).toHaveLength(days.length);

      for (const [index, header] of headers.entries()) {
        const day = days[index] ?? 0;
        const number = dayLabel(day, { day: "numeric" });
        let expected = number;

        if (width >= 32) {
          expected = `${number} ${dayLabel(day, { weekday: "narrow" })}`;
        }

        if (width >= 56) {
          expected = dayLabel(day, { day: "numeric", weekday: "short" });
        }

        expect(header.getAttribute("aria-label")).toBe(
          dayLabel(day, { dateStyle: "full" })
        );
        expect(header.querySelector(".day-header-label")?.textContent).toBe(
          expected
        );
        expect(header.classList.contains("is-today")).toBe(day === today);
      }

      expect(
        headers.filter((header) => header.classList.contains("is-today"))
      ).toHaveLength(1);
    }).pipe(Effect.scoped)
);
