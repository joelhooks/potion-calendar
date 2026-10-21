import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { monthInitialPosition } from "../src/client/month/host.js";
import { view } from "../src/features/app.js";
import { visibleDays, dayFromIso } from "../src/layout/navigation.js";
import {
  navigationFixture,
  navigationScenarios,
} from "./navigation-root-fixture.js";

it.effect(
  "exports root navigation states with geometry proofs and unchanged custom-hidden Month columns",
  () =>
    Effect.gen(function* navigationExports() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const theme of ["light", "dark"] as const) {
        for (const width of [1440, 900]) {
          for (const scenario of navigationScenarios) {
            const model = navigationFixture(theme, width, scenario);
            const month = model.calendar.navigation.mode === "month";
            const settings = scenario === "settings-hidden";

            const expected =
              new Map([
                ["week-hidden", [20_745, 20_747, 20_749, 20_750, 20_751]],
                ["week-hidden-weekends", [20_745, 20_747, 20_749]],
                [
                  "restored-period",
                  [20_745, 20_746, 20_747, 20_748, 20_749, 20_750, 20_751],
                ],
              ]).get(scenario) ?? [];

            if (!month && !settings) {
              expect(visibleDays(model.calendar.navigation)).toEqual(expected);
            }

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const document = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            if (settings) {
              expect(document.body.textContent).toContain(
                "Custom hidden weekdays affect time views, not Month."
              );
              expect(
                document.querySelectorAll(".settings-weekdays input[checked]")
              ).toHaveLength(5);
            } else if (month) {
              expect(
                document.querySelectorAll(".month-weekdays > div")
              ).toHaveLength(7);
              const target = monthInitialPosition(model).firstWeek + 42;
              expect(target).toBe(
                dayFromIso(
                  scenario === "month-align-today" ? "2026-10-19" : "2026-09-28"
                )
              );
            } else {
              expect(document.querySelectorAll(".day-column")).toHaveLength(
                expected.length
              );
            }

            const script = `document.fonts.ready.then(() => requestAnimationFrame(() => {
          const near = (a, b) => Math.abs(a - b) < 1;
          const month = ${month};
          const settings = ${settings};
          const expected = ${JSON.stringify(expected)};
          const time = document.querySelector('#time-viewport');
          if (time) time.scrollTop = 200;
          const viewport = document.querySelector('#month-viewport');
          const rows = [...document.querySelectorAll('.month-week:not([data-month-parked])')];
          const height = rows[0]?.getBoundingClientRect().height ?? 0;
          if (viewport) viewport.scrollTop = height * 6;
          const box = viewport?.getBoundingClientRect();
          const visible = rows.filter(row => { const rect = row.getBoundingClientRect(); return box && Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top) > height / 2; });
          const headers = [...document.querySelectorAll('.day-header')];
          const columns = [...document.querySelectorAll('.day-column')];
          const project = [...document.querySelectorAll('.all-day .event-chip')].find(chip => chip.querySelector('strong')?.textContent === 'Ship the calendar');
          const covered = expected.map((day, index) => day < 20750 ? index : -1).filter(index => index >= 0);
          const weekdayHeaders = [...document.querySelectorAll('.month-weekdays > div')];
          const controls = [...document.querySelectorAll('.settings-weekdays input')];
          const helper = document.querySelector('.settings-weekday-control p');
          const weekdayRow = helper?.closest('.settings-row');
          const review = [...document.querySelectorAll('.day-column .event-chip')].find(chip => chip.querySelector('strong')?.textContent === 'Product review');
          const design = [...document.querySelectorAll('.day-column .event-chip')].find(chip => chip.querySelector('strong')?.textContent === 'Design session');
          const probe = document.createElement('span');
          probe.style.color = 'var(--primary)'; probe.style.display = 'none';
          document.querySelector('.settings-content')?.append(probe);
          const primary = getComputedStyle(probe).color; probe.remove();
          const facts = {
            specifiedOverlap: month || settings || !!review && !!design && near(review.getBoundingClientRect().width, review.closest('.day-column').getBoundingClientRect().width * .75 - 3) && near(design.getBoundingClientRect().width, design.closest('.day-column').getBoundingClientRect().width * .5 - 3),
            selectedPaintPriority: month || settings || !!review && !!design && (Number(review.style.zIndex) > Number(design.style.zIndex)) === review.classList.contains('selected'),
            weekStartOrder: !settings || controls.map(control => control.getAttribute('aria-label')).join(',') === 'Show Monday,Show Tuesday,Show Wednesday,Show Thursday,Show Friday,Show Saturday,Show Sunday',
            appAccent: !settings || controls.every(control => getComputedStyle(control).accentColor === primary),
            helperGrouped: !settings || !!helper && !!weekdayRow && helper.getBoundingClientRect().bottom < weekdayRow.getBoundingClientRect().bottom && helper.getBoundingClientRect().top > controls[0].getBoundingClientRect().bottom,
            bounded: document.documentElement.scrollWidth <= innerWidth + 1,
            requestedDates: month || settings || JSON.stringify(columns.map(column => Number(column.dataset.day))) === JSON.stringify(expected),
            equalTimeColumns: month || settings || columns.length === expected.length && columns.every((column, index) => near(column.getBoundingClientRect().width, columns[0].getBoundingClientRect().width) && near(column.getBoundingClientRect().left, headers[index].getBoundingClientRect().left)),
            hiddenSpan: month || settings || !!project && covered.length > 0 && near(project.getBoundingClientRect().left, headers[covered[0]].getBoundingClientRect().left + 2) && near(project.getBoundingClientRect().right, headers[covered.at(-1)].getBoundingClientRect().right - 2),
            monthSixWeeks: !month || rows.length === 18 && visible.length === 6,
            monthSevenColumns: !month || weekdayHeaders.length === 7 && weekdayHeaders.every(header => near(header.getBoundingClientRect().width, weekdayHeaders[0].getBoundingClientRect().width)),
            explicitMonthTop: !month || Number(visible[0]?.dataset.weekStart) === ${month ? monthInitialPosition(model).firstWeek + 42 : 0},
            monthCustomUnaffected: ${scenario !== "month-custom-hidden"} || weekdayHeaders.map(node => node.textContent).join(',') === 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
            settingsCopy: !settings || document.querySelector('.settings-content')?.textContent.includes('Custom hidden weekdays affect time views, not Month.'),
            settingsControls: !settings || controls.length === 7 && controls.every(control => control.checked === !['Show Tuesday','Show Thursday'].includes(control.getAttribute('aria-label'))),
            controlsInBounds: !settings || controls.every(control => { const rect = control.parentElement.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; }),
          };
          document.documentElement.dataset.navigationProof = JSON.stringify({ passed: Object.values(facts).every(Boolean), facts });
          document.documentElement.dataset.fixtureReady = 'true';
        }));`;

            yield* fs.writeFileString(
              `../../.git/navigation-root-${theme}-${width}-${scenario}-fixture.html`,
              `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Navigation ${scenario}</title><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
