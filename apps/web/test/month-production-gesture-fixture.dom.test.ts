import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { ClipboardView } from "../src/client/clipboard/model.js";
import { gestureTarget } from "../src/client/editing/gesture-input.js";
import { GestureStart } from "../src/client/editing/gesture-model.js";
import { monthHostKey } from "../src/client/month/host.js";
import { view } from "../src/features/app.js";
import { gestureRange } from "../src/layout/gesture-range.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureModel } from "./fixture.js";
import { undoFixture } from "./undo-fixture.js";

const scenarios = [
  "read-only-refused",
  "moved-three",
  "move-preview",
  "resize-preview",
  "alt-copy-preview",
] as const;

const gestureFixture = (
  theme: "light" | "dark",
  scenario: (typeof scenarios)[number]
) => {
  const base = fixtureModel();

  const original = {
    ...base,
    calendar: {
      ...base.calendar,
      navigation: { ...base.calendar.navigation, mode: "month" as const },
      viewport: 844,
    },
    settings: { ...base.settings, showWeekNumbers: true, theme },
  };

  let model = {
    ...original,
    calendar: {
      ...original.calendar,
      reads: original.calendar.reads.map((read) => {
        const data = Option.getOrThrow(AsyncData.getData(read.events));

        return {
          ...read,
          events: RemoteEvents.Success({
            data: {
              ...data,
              events: data.events.map((event) =>
                event.eventId === "a-review"
                  ? {
                      ...event,
                      end: { dateTime: "2026-10-19T09:57:00-07:00" },
                      organizer: { email: "owner@example.test", self: true },
                      start: { dateTime: "2026-10-19T09:07:00-07:00" },
                    }
                  : {
                      ...event,
                      organizer: { email: "owner@example.test", self: true },
                    }
              ),
            },
          }),
        };
      }),
    },
  };

  const target = visibleEvents(model).find(
    (event) => event.source.eventId === "a-review"
  );

  const allDay = visibleEvents(model).find((event) => event.allDay);

  if (target === undefined || allDay === undefined) {
    throw new Error("Missing month gesture fixture targets");
  }

  const selected = [
    allDay.key,
    target.key,
    ...visibleEvents(model)
      .filter((event) => event.key !== allDay.key && event.key !== target.key)
      .slice(0, 1)
      .map((event) => event.key),
  ];

  model = { ...model, calendar: { ...model.calendar, selected } };

  if (scenario === "read-only-refused") {
    model = {
      ...model,
      calendar: {
        ...model.calendar,
        calendars: model.calendar.calendars.map((calendar) =>
          calendar.accountId === target.calendar.accountId &&
          calendar.calendarId === target.calendar.calendarId
            ? { ...calendar, accessRole: "reader" as const }
            : calendar
        ),
      },
    };

    const undo = undoFixture().intent;
    model = {
      ...model,
      clipboard: {
        ...model.clipboard,
        sessionId: Option.some("gesture-notice-stack"),
        view: ClipboardView.cases.Idle.make({
          copied: Option.none(),
          toast: Option.some({
            id: "gesture-stack-copy",
            message: "Event copied.",
          }),
        }),
      },
      editing: {
        ...model.editing,
        conferencingResult: Option.some({
          accountId: "work",
          calendarId: "primary",
          eventId: "prior-save",
          id: "gesture-stack-conferencing",
          status: "ready",
          title: "Previous event",
        }),
        deletes: [
          {
            afterRead: Option.none(),
            intent: {
              ...undo,
              event: { ...undo.event, eventId: "notice-undo" },
              id: "gesture-stack-undo",
              request: { ...undo.request, eventId: "notice-undo" },
              title: "Previous event",
            },
            phase: "pending",
          },
        ],
      },
    };

    return update(
      model,
      Message.RefusedGesture({
        hostKey: Option.getOrThrow(monthHostKey(model)),
        personId: Option.getOrThrow(model.person),
        reason: "ReadOnlyEvent",
      })
    ).model;
  }

  if (scenario === "moved-three") {
    return {
      ...model,
      calendar: {
        ...model.calendar,
        reads: model.calendar.reads.map((read) => {
          const data = Option.getOrThrow(AsyncData.getData(read.events));

          return {
            ...read,
            events: RemoteEvents.Success({
              data: {
                ...data,
                events: data.events.map((event) =>
                  event.eventId === "a-review"
                    ? {
                        ...event,
                        end: { dateTime: "2026-10-20T09:57:00-07:00" },
                        start: { dateTime: "2026-10-20T09:07:00-07:00" },
                      }
                    : event
                ),
              },
            }),
          };
        }),
      },
    };
  }

  const item = scenario === "resize-preview" ? allDay : target;

  const point = {
    alt: scenario === "alt-copy-preview",
    at: 1,
    day: item.startDay,
    minute: 0,
    pointerId: 1,
    shift: false,
    x: 0,
    y: 0,
  };

  const start = GestureStart.make({
    allDay: true,
    edge: scenario === "resize-preview" ? "end" : "body",
    point,
    target: gestureTarget(item, model.calendar.zone),
  });

  const preview = gestureRange(
    start,
    { ...point, at: 2, day: item.endDay + 2, x: 50 },
    1
  );

  return {
    ...model,
    editing: { ...model.editing, gesture: Option.some(preview) },
  };
};

it.effect.each([
  { format: "12" as const, label: "9:07am" },
  { format: "24" as const, label: "09:07" },
])(
  "month previews put the setting-aware clock first ($format)",
  ({ format, label }) =>
    Effect.gen(function* previewFormat() {
      const base = gestureFixture("light", "move-preview");

      const model = {
        ...base,
        settings: { ...base.settings, timeFormat: format },
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const preview = document.querySelector(".month-gesture-preview");
      expect(preview?.firstElementChild?.textContent).toBe(label);
      expect(preview?.querySelector("strong")?.textContent).toBe(
        "Product review"
      );
    })
);

it.effect(
  "exports actual-renderer production month gesture states for desk capture",
  () =>
    Effect.gen(function* gestureExports() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const theme of ["light", "dark"] as const) {
        for (const width of [1440, 900]) {
          for (const scenario of scenarios) {
            const model = gestureFixture(theme, scenario);
            expect(model.calendar.selected).toHaveLength(3);

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const document = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            const selectedChips = [
              ...document.querySelectorAll(".event-chip.selected"),
            ];

            expect(selectedChips).toHaveLength(3);

            const review = selectedChips.find(
              (chip) =>
                chip.querySelector("strong")?.textContent === "Product review"
            );

            expect(review?.querySelector(".event-time")?.textContent).toBe(
              "9:07am"
            );

            if (scenario === "moved-three") {
              expect(
                review?.closest<HTMLElement>("[data-day]")?.dataset.day
              ).toBe("20746");
            }

            if (scenario === "read-only-refused") {
              expect(
                document.querySelector(".gesture-refusal")?.textContent
              ).toContain(
                "You can only view this event, so it can't be moved. Nothing was changed."
              );
              expect(
                document.querySelector(
                  ".notification-stack .gesture-refusal button"
                )?.textContent
              ).toBe("Dismiss");
            }

            if (scenario.endsWith("preview")) {
              expect(
                document.querySelector(".month-gesture-preview")
              ).not.toBeNull();
            }

            const script = `document.fonts.ready.then(() => requestAnimationFrame(() => {
          const viewport = document.querySelector('#month-viewport');
          const rows = [...document.querySelectorAll('.month-week')];
          if (viewport) viewport.scrollTop = (rows[0]?.getBoundingClientRect().height ?? 0) * 6;
          const scenario = document.documentElement.dataset.gestureScenario;
          const selected = [...document.querySelectorAll('.event-chip.selected')];
          const review = selected.find(node => node.querySelector('strong')?.textContent === 'Product review');
          const previews = [...document.querySelectorAll('.month-gesture-preview')];
          const timedPreviews = previews.filter(node => !node.classList.contains('month-gesture-preview-all-day'));
          const stack = document.querySelector('.notification-stack');
          const notices = stack ? [...stack.children].flatMap(child => getComputedStyle(child).display === 'contents' ? [...child.children] : [child]).filter(node => node.getBoundingClientRect().height > 0) : [];
          const near = (a, b) => Math.abs(a - b) < 1;
          const facts = {
            previewTimeFirst: timedPreviews.every(node => node.firstElementChild?.classList.contains('month-preview-time') && node.firstElementChild.textContent === '9:07am'),
            previewTimeUnclipped: timedPreviews.every(node => { const time = node.querySelector('.month-preview-time'); return !!time && time.scrollWidth <= time.clientWidth + 1; }),
            noticeBounds: scenario !== 'read-only-refused' || notices.length >= 4 && notices.every(node => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight; }),
            noticeNoCollision: scenario !== 'read-only-refused' || notices.every((node, index) => index === 0 || notices[index - 1].getBoundingClientRect().bottom <= node.getBoundingClientRect().top),
            noticeBottomRight: scenario !== 'read-only-refused' || !!stack && near(stack.getBoundingClientRect().right, innerWidth - 24) && near(stack.getBoundingClientRect().bottom, innerHeight - 24),
            selectionCount: document.querySelector('.month-view')?.dataset.selectionCount === '3',
            selectedChips: selected.length === 3,
            oddMinuteClock: review?.querySelector('.event-time')?.textContent === '9:07am',
            refused: scenario !== 'read-only-refused' || document.querySelector('.notification-stack .gesture-refusal')?.textContent.includes("You can only view this event, so it can't be moved. Nothing was changed."),
            moved: scenario !== 'moved-three' || review?.closest('[data-day]')?.dataset.day === '20746',
            preview: !scenario.endsWith('preview') || previews.length > 0,
            noTimedResize: document.querySelector('.month-item-timed [data-resize-edge]') === null,
            bounded: document.documentElement.scrollWidth <= innerWidth + 1,
          };
          document.documentElement.dataset.monthGestureProof = JSON.stringify({ passed: Object.values(facts).every(Boolean), facts });
          document.documentElement.dataset.fixtureReady = 'true';
        }));`;

            const html = `<!doctype html><html lang="en" data-gesture-scenario="${scenario}"><head><meta charset="utf-8"><title>Month gesture ${scenario}</title><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;
            yield* fs.writeFileString(
              `../../.git/month-gesture-${theme}-${width}-${scenario}-fixture.html`,
              html
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
