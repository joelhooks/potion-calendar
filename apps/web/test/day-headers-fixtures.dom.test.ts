import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { dayInZone, visibleDays } from "../src/layout/navigation.js";
import { dayLabel } from "../src/layout/presentation.js";
import { zoneColumns } from "../src/layout/time-zones-grid.js";
import { dayHeadersFixture } from "./day-headers-fixture.js";
import { dayHeadersProofScript } from "./day-headers-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const realisticWidths = {
  "closed-1440": 168,
  "closed-900": 96,
  "open-1440": 125,
  "open-900": 59,
};

const matrix = [
  ...(["open", "closed"] as const).flatMap((panel) =>
    (["light", "dark"] as const).flatMap((theme) =>
      ([900, 1440] as const).map((width) => ({
        floor: false,
        panel,
        theme,
        width,
      }))
    )
  ),
  {
    floor: true,
    panel: "open" as const,
    theme: "dark" as const,
    width: 900 as const,
  },
  {
    floor: true,
    panel: "open" as const,
    theme: "light" as const,
    width: 1440 as const,
  },
];

for (const { width, theme, panel, floor } of matrix) {
  const name = floor ? `floor-${theme}-${width}` : `${panel}-${theme}-${width}`;

  it.effect(`exports day headers ${name}`, () =>
    Effect.gen(function* exportDayHeaders() {
      const model = dayHeadersFixture(width, theme, panel, floor);
      const days = visibleDays(model.calendar.navigation);

      const dayWidth = zoneColumns(
        model.calendar.viewportWidth,
        days.length,
        4
      ).day;

      const expectedLabels = days.map((day) =>
        floor
          ? dayLabel(day, { day: "numeric" })
          : dayLabel(day, { day: "numeric", weekday: "short" })
      );

      expect(dayWidth).toBe(floor ? 16 : realisticWidths[`${panel}-${width}`]);
      expect(floor || dayWidth >= 56).toBe(true);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const script = dayHeadersProofScript({
        ariaLabels: days.map((day) => dayLabel(day, { dateStyle: "full" })),
        dayWidth,
        floor,
        labels: expectedLabels,
        panel,
        today: dayInZone(model.calendar.now, model.calendar.zone),
        width,
      });

      const html = `<!doctype html><html data-fixture-kind="${floor ? "explicit-16px-floor" : "realistic-panel-geometry"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P16 ${name}${floor ? " explicit 16px floor" : " realistic viewport"}</title><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const exact = parsed.querySelector("script")?.textContent;

      expect(exact).toBe(script);
      runInNewContext(
        exact ?? "throw new Error('Missing exact proof script')",
        {
          document: parsed,
          window: { __dayHeadersStandIn: true, innerWidth: width },
        }
      );
      expect(parsed.documentElement.dataset.dayHeadersProof).toBe(
        "JSDOM stand-in; not browser proof"
      );
      expect(parsed.documentElement.dataset.fixtureReady).toBe("day-headers");

      return yield* publishFixtureArtifact(
        `../../.git/day-headers-${name}-fixture.html`,
        html
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
}
