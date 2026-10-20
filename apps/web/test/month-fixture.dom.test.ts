import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import { eventKey } from "../src/client/calendar-state.js";
import { view } from "../src/features/app.js";
import { monthFixture, monthScrollingFixture } from "./month-fixture.js";

const proof = `document.fonts.ready.then(() => requestAnimationFrame(() => {
 const month = document.querySelector('.month-view');
 const header = document.querySelector('.month-weekdays');
 const viewport = document.querySelector('#month-viewport');
 const rows = [...document.querySelectorAll('.month-week')];
 const rowHeight = rows[0]?.getBoundingClientRect().height ?? 0;
 if (viewport) viewport.scrollTop = rowHeight * 6;
 const viewportBox = viewport?.getBoundingClientRect();
 const visible = rows.filter(row => { const box = row.getBoundingClientRect(); return viewportBox && Math.min(box.bottom, viewportBox.bottom) - Math.max(box.top, viewportBox.top) > rowHeight / 2; });
 const gutters = [...document.querySelectorAll('.month-week-number')];
 const shown = document.documentElement.dataset.monthWeekNumbers === '1';
 const chip = document.querySelector('.month-item-timed .event-chip:not(.selected)');
 const clock = chip?.querySelector('.event-time');
 const near = (a, b) => Math.abs(a - b) < 1;
 const panel = document.querySelector('#upcoming-meeting');
 const labels = [...document.querySelectorAll('.month-view .event-chip strong')].map(node => node.textContent);
 const project = [...document.querySelectorAll('.month-span')].find(node => node.textContent === 'Ship the calendar');
 const facts = {
  header29: !!header && near(header.getBoundingClientRect().height, 29),
  sixEqualRows: rows.length === 18 && visible.length === 6 && rows.every(row => near(row.getBoundingClientRect().height, (month.getBoundingClientRect().height - 29) / 6)),
  weekGutter: shown ? gutters.length === 18 && gutters.every(gutter => near(gutter.getBoundingClientRect().width, 24)) : gutters.length === 0,
  noInlineWeekLabels: document.querySelector('.month-date .week-number,.mini-week-number') === null,
  clockVisible: !!clock && getComputedStyle(clock).display !== 'none' && clock.getBoundingClientRect().width > 0,
  compactTimed: !!chip && getComputedStyle(chip).flexDirection === 'row' && getComputedStyle(chip).backgroundColor === 'rgba(0, 0, 0, 0)',
  oneProjectBar: labels.filter(label => label === 'Ship the calendar').length === 1 && !!project && Number(project.dataset.endColumn) - Number(project.dataset.startColumn) === 5,
  noFixtureDuplicates: labels.filter(label => label === 'At home').length === 1 && labels.filter(label => label === 'Lunch with Sam').length === 1,
  seededUpcoming: panel?.querySelector('.upcoming-title')?.textContent === 'Month planning' && !panel.textContent.includes('Loading upcoming meetings') && labels.includes('Month planning'),
  overflowPresent: document.querySelector('.month-cell .overflow-count') !== null,
  bounded: !!month && month.scrollWidth <= month.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1,
 };
 document.documentElement.dataset.monthLayoutProof = JSON.stringify({ passed: Object.values(facts).every(Boolean), facts });
 document.documentElement.dataset.fixtureReady = 'true';
}));`;

const scrollProof = `document.fonts.ready.then(() => requestAnimationFrame(() => {
 const viewport = document.querySelector('#month-viewport');
 const rows = [...document.querySelectorAll('.month-week:not([data-month-parked])')];
 const height = rows[0]?.getBoundingClientRect().height ?? 0;
 if (viewport) viewport.scrollTop = height * 6;
 const box = viewport?.getBoundingClientRect();
 const visible = rows.filter(row => { const rect = row.getBoundingClientRect(); return box && Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top) > height / 2; });
 const parked = document.documentElement.dataset.monthParked === '1';
 const pin = document.querySelector('[data-month-parked]');
 const focused = pin?.querySelector('.event-chip.selected');
 if (focused) focused.focus({ preventScroll: true });
 const labels = visible.flatMap(row => [...row.querySelectorAll('.event-chip strong')].map(node => node.textContent));
 const facts = {
  eighteenRows: rows.length === 18,
  sixVisible: visible.length === 6,
  nativeScroll: !!viewport && Math.abs(viewport.scrollTop - height * 6) < 1,
  parkedBound: document.querySelectorAll('.month-week').length === (parked ? 19 : 18) && !!pin === parked,
  parkedFocus: !parked || !!focused && document.activeElement === focused,
  sixRollingMeetings: labels.filter(label => label.startsWith('Rolling meeting ')).length === 6,
  splitProject: [...document.querySelectorAll('.month-span')].filter(node => node.textContent === 'Rolling project').length === 2,
  midpointLabel: document.querySelector('.toolbar h2')?.textContent === document.documentElement.dataset.monthLabel,
  bounded: !!viewport && viewport.scrollWidth <= viewport.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1,
 };
 document.documentElement.dataset.monthScrollProof = JSON.stringify({ passed: Object.values(facts).every(Boolean), facts });
 document.documentElement.dataset.fixtureReady = 'true';
}));`;

it.effect(
  "exports default-hidden and deliberately shown week-number month layouts with unique provider references and seeded upcoming data",
  () =>
    Effect.gen(function* monthExports() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const theme of ["light", "dark"] as const) {
        for (const width of [1440, 900]) {
          for (const shown of [false, true]) {
            if (shown && width !== 900) {
              continue;
            }

            const model = monthFixture(theme, shown);

            const gridEvents = model.calendar.reads.flatMap((read) => {
              const data = AsyncData.getData(read.events);

              return Option.isSome(data) ? data.value.events : [];
            });

            const keys = gridEvents.map(eventKey);
            expect(new Set(keys).size).toBe(keys.length);

            const upcoming = Option.getOrThrow(
              AsyncData.getData(model.upcoming.data)
            );

            for (const event of upcoming.events) {
              expect(
                gridEvents.find((item) => eventKey(item) === eventKey(event))
              ).toEqual(event);
            }

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const document = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            expect(
              document.querySelectorAll(".month-week-number")
            ).toHaveLength(shown ? 18 : 0);
            expect(document.querySelector(".mini-week-number")).toBeNull();
            expect(document.querySelector(".overflow-count")).not.toBeNull();
            expect(document.querySelector(".upcoming-title")?.textContent).toBe(
              "Month planning"
            );

            const labels = [
              ...document.querySelectorAll(".month-view .event-chip strong"),
            ].map((node) => node.textContent);

            for (const title of [
              "Ship the calendar",
              "At home",
              "Lunch with Sam",
              "Month planning",
            ]) {
              expect(labels.filter((label) => label === title)).toHaveLength(1);
            }

            const output = `<!doctype html><html data-month-week-numbers="${Number(shown)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`;
            yield* fs.writeFileString(
              `../../.git/month-layout-${shown ? "weeks-" : ""}${theme}-${width}-fixture.html`,
              output
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "exports rebased and parked rendered-state scrolling fixtures with the desk-default straddling-month labels",
  () =>
    Effect.gen(function* scrollingExports() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const theme of ["light", "dark"] as const) {
        for (const width of [1440, 900]) {
          for (const parked of [false, true]) {
            const model = monthScrollingFixture(theme, parked);

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const document = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            const label = parked ? "December 2026" : "November 2026";
            expect(document.querySelector(".toolbar h2")?.textContent).toBe(
              label
            );
            expect(document.querySelectorAll(".month-week")).toHaveLength(
              parked ? 19 : 18
            );
            expect(
              document.querySelectorAll("[data-month-parked]")
            ).toHaveLength(Number(parked));

            const keys = model.calendar.reads.flatMap((read) =>
              Option.getOrThrow(AsyncData.getData(read.events)).events.map(
                eventKey
              )
            );

            expect(new Set(keys).size).toBe(keys.length);
            const output = `<!doctype html><html data-month-parked="${Number(parked)}" data-month-label="${label}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-kind" content="rendered-state"><style>${css}</style></head><body>${rendered.html}<script>${scrollProof}</script></body></html>`;
            yield* fs.writeFileString(
              `../../.git/month-scroll-${theme}-${width}-${parked ? "parked" : "rebased"}-fixture.html`,
              output
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
