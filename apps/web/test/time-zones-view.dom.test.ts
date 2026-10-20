import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { applyZonePreferences } from "../src/client/time-zones/update.js";
import { view } from "../src/features/app.js";
import { hourHeight, timeColumns } from "../src/layout/geometry.js";
import { dayInZone } from "../src/layout/navigation.js";
import { allDaySection } from "../src/layout/presentation.js";
import { SettingsRoute } from "../src/layout/route.js";
import { timeZonesFixture } from "./time-zones-fixture.js";

it.effect(
  "secondary gutters have 46px columns, formatted labels and no copied event chips",
  () =>
    Effect.gen(function* secondaryGutters() {
      const model = timeZonesFixture();

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.querySelectorAll(".zone-header")).toHaveLength(3);
      expect(document.querySelectorAll(".time-labels")).toHaveLength(3);
      expect(
        document.querySelector(".day-headers")?.getAttribute("style")
      ).toContain("repeat(3, 46px)");
      expect(
        document.querySelector(".day-columns")?.getAttribute("style")
      ).toContain("grid-column: 4 / 11");

      for (const gutter of document.querySelectorAll(".time-labels")) {
        expect(gutter.querySelectorAll("span")).toHaveLength(24);
        expect(gutter.querySelectorAll(".event-chip")).toHaveLength(0);
      }

      expect(
        document.querySelectorAll(".day-columns .event-chip").length
      ).toBeGreaterThan(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "travelling uses Tokyo for now-line and event placement while the labelled home column remains",
  () =>
    Effect.gen(function* travelGrid() {
      const model = timeZonesFixture(true);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.querySelectorAll(".zone-header")).toHaveLength(4);
      expect(
        document.querySelector(
          '.zone-header[data-zone-id="America/Los_Angeles"]'
        )?.textContent
      ).toContain("Home");
      expect(
        document.querySelector('.zone-header[data-zone-id="Asia/Tokyo"]')
      ).not.toBeNull();

      const parts = new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hourCycle: "h23",
        minute: "2-digit",
        timeZone: "Asia/Tokyo",
      }).formatToParts(model.calendar.now);

      const minute =
        Number(parts.find((part) => part.type === "hour")?.value) * 60 +
        Number(parts.find((part) => part.type === "minute")?.value);

      const scale = hourHeight(
        model.calendar.zoom,
        model.calendar.viewport,
        allDaySection(model).height
      );

      const line = document.querySelector<HTMLElement>(".now-today");
      expect(line?.style.top).toBe(`${(minute * scale) / 60}px`);
      expect(line?.closest<HTMLElement>(".day-column")?.dataset.day).toBe(
        String(dayInZone(model.calendar.now, "Asia/Tokyo"))
      );

      const review = [
        ...document.querySelectorAll<HTMLElement>(".day-columns .event-chip"),
      ].find(
        (chip) =>
          chip.getAttribute("aria-label")?.startsWith("Product review,") ===
          true
      );

      expect(review?.style.top).toBe(`${scale}px`);
      expect(review?.closest<HTMLElement>(".day-column")?.dataset.day).toBe(
        String(
          dayInZone(
            DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-19T16:00:00Z")),
            "Asia/Tokyo"
          )
        )
      );
    }).pipe(Effect.scoped)
);

it.effect(
  "the all-day collapse control has a visible chevron and matching accessible expansion state",
  () =>
    Effect.gen(function* allDayControl() {
      for (const expanded of [true, false]) {
        const base = timeZonesFixture();

        const model = {
          ...base,
          calendar: { ...base.calendar, allDayExpanded: expanded },
        };

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        const button = document.querySelector(".all-day-toggle");
        expect(button?.getAttribute("aria-label")).toBe(
          expanded ? "Collapse all-day events" : "Expand all-day events"
        );
        expect(button?.getAttribute("aria-expanded")).toBe(String(expanded));
        expect(button?.textContent).toBe(expanded ? "▴" : "▾");
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "a changed-system prompt is visible on a Settings landing rather than lost behind the calendar toolbar",
  () =>
    Effect.gen(function* settingsPrompt() {
      const base = timeZonesFixture();

      const model = {
        ...base,
        route: SettingsRoute.make({ page: "general" }),
        timeZones: applyZonePreferences(
          { ...base.timeZones, system: "Asia/Tokyo" },
          base.timeZones.preferences
        ),
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.querySelector(".toolbar")?.textContent).toBe("Calendar");
      expect(
        document.querySelector(".zone-system-prompt")?.textContent
      ).toContain("Asia/Tokyo");
      expect(
        document.querySelector(".zone-system-prompt")?.closest(".toolbar")
      ).toBeNull();
    }).pipe(Effect.scoped)
);

it.effect(
  "a primary-only gutter stays 46px and uses its labelled chevron without wrapping the all-day caption",
  () =>
    Effect.gen(function* primaryOnlyCaption() {
      const base = timeZonesFixture();

      const model = {
        ...base,
        timeZones: {
          ...base.timeZones,
          preferences: { ...base.timeZones.preferences, secondary: [] },
        },
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(document.querySelectorAll(".zone-header")).toHaveLength(1);
      expect(
        document.querySelector<HTMLElement>(".all-day-gutter")?.style.width
      ).toBe("46px");
      expect(
        document.querySelector<HTMLElement>(".all-day-label")?.style.display
      ).toBe("none");
      expect(
        document.querySelector<HTMLElement>(".all-day-label")?.style.whiteSpace
      ).toBe("nowrap");
      expect(
        document.querySelector(".all-day-toggle")?.getAttribute("aria-label")
      ).toBe("Collapse all-day events");
      expect(
        document.querySelector(".all-day-toggle")?.getAttribute("title")
      ).toBe("Collapse all-day events");
    }).pipe(Effect.scoped)
);

it.effect(
  "exports two-secondary, travelling and dark grids at 1440 and 900 for fenced review",
  () =>
    Effect.gen(function* zoneArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const width of [1440, 900]) {
        for (const [name, travel, dark] of [
          ["secondaries", false, false],
          ["travelling", true, false],
          ["dark", true, true],
          ["no-details", true, true],
        ] as const) {
          if (name === "no-details" && width !== 900) {
            continue;
          }

          const sidebar = width <= 1000 ? 185 : 220;
          const fullDetails = width <= 1000 ? 260 : 300;
          const details = name === "no-details" ? 0 : fullDetails;

          const base = timeZonesFixture(
            travel,
            dark,
            width - sidebar - details
          );

          const model =
            name === "no-details"
              ? {
                  ...base,
                  calendar: { ...base.calendar, selected: Option.none() },
                }
              : base;

          const minimum = timeColumns(model.calendar.viewportWidth, 7).day;

          const rendered = yield* renderToString(
            { init: () => ({ model }), view },
            { isHydratable: false }
          );

          const proof = `const frame=document.querySelector('#time-viewport');const panel=document.querySelector('.detail-panel');if(document.documentElement.scrollWidth!==innerWidth)throw Error('Page widened');if(!frame)throw Error('Missing grid viewport');if(Math.abs(frame.getBoundingClientRect().right-(panel?.getBoundingClientRect().left??innerWidth))>1)throw Error('Grid leaves blank strip');for(const day of document.querySelectorAll('.day-column'))if(day.getBoundingClientRect().width<${minimum}-0.5)throw Error('Crushed day column');const oldLeft=frame.scrollLeft;frame.scrollLeft=Math.min(120,frame.scrollWidth-frame.clientWidth);const left=frame.getBoundingClientRect().left;for(const selector of ['.zone-header','.time-labels'])[...document.querySelectorAll(selector)].forEach((node,index)=>{if(Math.abs(node.getBoundingClientRect().left-left-index*46)>1)throw Error('Zone gutter moved');});if(Math.abs(document.querySelector('.all-day-gutter').getBoundingClientRect().left-left)>1)throw Error('All-day gutter moved');frame.scrollTop=80;if(Math.abs(document.querySelector('.day-headers').getBoundingClientRect().top-frame.getBoundingClientRect().top)>1)throw Error('Day header moved');frame.scrollTop=0;frame.scrollLeft=oldLeft;document.documentElement.dataset.zoneLayoutProof='pass';`;
          const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Time zones fixture</title><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`;
          yield* fs.writeFileString(
            `../../.git/time-zones-${name}-${width}-fixture.html`,
            html
          );
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
