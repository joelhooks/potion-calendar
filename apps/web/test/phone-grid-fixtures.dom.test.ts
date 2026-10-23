import { runInNewContext } from "node:vm";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { monthFrame, monthInitialPosition } from "../src/client/month/host.js";
import { gridZones } from "../src/client/phone-grid/model.js";
import { view } from "../src/features/app.js";
import { monthWeeks } from "../src/layout/month.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { phoneGridFixture, phoneGridScenes } from "./phone-grid-fixture.js";
import { phoneGridProofScript } from "./phone-grid-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

for (const scene of phoneGridScenes) {
  it.effect(
    `exports phone grid ${scene.scene} ${scene.width} ${scene.theme}`,
    () =>
      Effect.gen(function* exportPhoneGrid() {
        const model = phoneGridFixture(scene);

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const events = visibleEvents(model);

        const counts =
          scene.scene === "month"
            ? Object.fromEntries(
                monthWeeks(
                  model.calendar.navigation,
                  monthFrame(model)
                ).flatMap((week) =>
                  week.days
                    .filter((day) => day.enabled)
                    .map(
                      ({ day }) =>
                        [
                          String(day),
                          events.filter(
                            (event) =>
                              event.startDay <= day && day < event.endDay
                          ).length,
                        ] as const
                    )
                )
              )
            : {};

        const monthPosition =
          scene.scene === "month"
            ? {
                firstVisibleDay:
                  monthWeeks(model.calendar.navigation)[0]?.start ??
                  model.calendar.navigation.anchor,
                scrollTop: monthInitialPosition(model).scrollTop,
              }
            : undefined;

        const script = phoneGridProofScript({
          ...scene,
          counts,
          monthPosition,
          zones: gridZones(model).map((zone) => zone.id),
        });

        const fs = yield* FileSystem.FileSystem;
        const css = yield* fs.readFileString("src/client/style.css");
        const html = `<!doctype html><html data-fixture-kind="phone-grid"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M2 ${scene.scene} ${scene.width} ${scene.theme}</title><style>${css}</style></head><body>${rendered.html}<script>${script}</script></body></html>`;
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const exact = parsed.querySelector("script")?.textContent;
        expect(exact).toBe(script);
        runInNewContext(
          exact ?? "throw new Error('Missing exact proof script')",
          { document: parsed, window: { __JSDOM_STAND_IN__: true } }
        );

        if (monthPosition !== undefined) {
          expect(
            parsed.querySelector<HTMLElement>("#month-viewport")?.scrollTop
          ).toBe(monthPosition.scrollTop);
          expect(monthPosition.scrollTop).toBeGreaterThan(0);
        }

        expect(parsed.documentElement.dataset.fixtureReady).toBe("phone-grid");
        expect(parsed.documentElement.dataset.phoneGridProof).toBe(
          "JSDOM stand-in; not browser proof"
        );

        return yield* publishFixtureArtifact(
          `../../.git/phone-grid-${scene.scene}-${scene.theme}-${scene.width}-fixture.html`,
          html
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
}
