import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { hourHeight, timeTop } from "../src/layout/geometry.js";
import { timedContent } from "../src/layout/timed-content.js";
import { compactSceneModel } from "./compact-timed-fixture.js";
import { compactResize } from "./compact-timed-native.js";

const pixels = (value: string | undefined): number =>
  Number((value ?? "0").replace("px", ""));

it.effect.prop(
  "content mode follows physical two-row space across duration and zoom, not a minute cutoff",
  {
    duration: Schema.Int.check(Schema.isBetween({ maximum: 120, minimum: 0 })),
    zoom: Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: -4 })),
  },
  ({ duration, zoom }) =>
    Effect.sync(() => {
      const height = Math.max(16, timeTop(duration, hourHeight(zoom, 904)) - 2);

      for (const surface of ["chip", "preview"] as const) {
        const content = timedContent(height, surface);
        const line = pixels(content.style["--timed-stack-line"]);
        const gap = pixels(content.style["--timed-stack-gap"]);
        const padding = pixels(content.style["--timed-stack-padding"]);
        const border = pixels(content.style["--timed-border"]);
        const required = 2 * line + gap + 2 * (padding + border);
        expect(content.compact).toBe(height < required);
        expect(content.budget).toBe(required);

        if (content.compact) {
          expect(pixels(content.style["--timed-padding"])).toBe(0);
          expect(
            pixels(content.style["--timed-line"]) + 2 * border
          ).toBeLessThanOrEqual(height);
        }
      }
    })
);

it.effect(
  "the same thirty-minute event changes mode with zoom and exact physical budget boundaries are stable",
  () =>
    Effect.sync(() => {
      expect(timedContent(22, "chip").compact).toBe(true);
      expect(timedContent(46, "chip").compact).toBe(false);

      for (const surface of ["chip", "preview"] as const) {
        const { budget } = timedContent(16, surface);
        expect(timedContent(budget - 1, surface).compact).toBe(true);
        expect(timedContent(budget, surface).compact).toBe(false);
        expect(timedContent(budget + 1, surface).compact).toBe(false);
      }
    })
);

it.effect.each(["light", "dark"] as const)(
  "%s actual-root short chips show time before title while labels/details keep the complete range",
  (theme) =>
    Effect.gen(function* rootCompactContent() {
      const model = compactSceneModel("short-pair", 1440, theme);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const chips = [
        ...document.querySelectorAll<HTMLElement>(".day-column .event-chip"),
      ];

      expect(chips).toHaveLength(2);

      for (const chip of chips) {
        expect(chip.dataset.contentMode).toBe("compact");

        const readout = chip.querySelector(".timed-readout");
        expect(readout).not.toBeNull();

        const children = [...(readout?.children ?? [])].filter((child) =>
          child.matches("strong,.event-time")
        );

        expect(children[0]?.classList.contains("event-time")).toBe(true);
        expect(children[1]?.tagName).toBe("STRONG");
        expect(children[0]?.textContent).toBe(
          theme === "dark" ? "09:00" : "9am"
        );
        expect(chip.querySelector(".calendar-ribbon")).not.toBeNull();
      }

      expect(chips[0]?.getAttribute("aria-label")).toContain(
        theme === "dark" ? "09:00 to 09:15" : "9am to 9:15am"
      );
      expect(chips[1]?.getAttribute("aria-label")).toContain(
        theme === "dark" ? "09:00 to 09:30" : "9am to 9:30am"
      );
      expect(document.querySelector(".detail-panel")?.textContent).toContain(
        theme === "dark" ? "09:15" : "9:15am"
      );
      expect(chips[0]?.querySelectorAll(".resize-handle")).toHaveLength(2);
    })
);

it.effect(
  "stacked boundary and overlap controls preserve normal range order and overlap geometry",
  () =>
    Effect.gen(function* normalControls() {
      for (const scene of ["boundary", "overlap"] as const) {
        const model = compactSceneModel(scene, 1440, "light");

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        const modes = [
          ...document.querySelectorAll<HTMLElement>(".day-column .event-chip"),
        ].map((chip) => chip.dataset.contentMode ?? "");

        expect(
          modes.toSorted((left, right) => left.localeCompare(right))
        ).toEqual(["compact", "stacked"]);

        const tall = document.querySelector<HTMLElement>(
          '[data-content-mode="stacked"]'
        );

        expect(tall?.querySelector(".event-time")?.textContent).toContain("–");

        const first = [...(tall?.children ?? [])].find((child) =>
          child.matches("strong,.event-time")
        );

        expect(first?.tagName).toBe("STRONG");

        if (scene === "overlap") {
          expect(tall?.style.width).not.toBe("calc(100% - 3px)");
        }
      }
    })
);

it.effect(
  "real resize binding projects a compact preview with the live full range first and releases its scope",
  () =>
    Effect.gen(function* resizeContent() {
      const native = yield* Effect.scoped(
        compactResize(compactSceneModel("resize", 1440, "dark"))
      );

      expect(native.proof.actorPhase).toBe("dragging");
      expect(native.proof.endTime).toBe("09:15");
      expect(native.proof.startTime).toBe("09:00");
      expect(native.proof.edge).toBe("end");
      expect(native.proof.steps).toHaveLength(3);

      const rendered = yield* renderToString(
        { init: () => ({ model: native.model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const preview = document.querySelector<HTMLElement>(".gesture-preview");
      const height = pixels(preview?.style.height);
      const expectedContent = timedContent(height, "preview");

      expect(height).toBe(16);
      expect(preview?.dataset.contentBudget).toBe(
        String(expectedContent.budget)
      );
      expect(preview?.style.getPropertyValue("--timed-line")).toBe(
        expectedContent.style["--timed-line"]
      );
      expect(preview?.dataset.contentMode).toBe("compact");
      expect(preview?.querySelector(".event-time")?.textContent).toBe(
        "09:00–09:15"
      );
      expect(
        preview
          ?.querySelector(".timed-readout")
          ?.children[0]?.classList.contains("event-time")
      ).toBe(true);
      expect(preview?.querySelector("strong")?.textContent).toContain(
        "Standup"
      );
    })
);
