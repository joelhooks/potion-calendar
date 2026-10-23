import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { rsvpChipFixture, rsvpScenes } from "./rsvp-chip-fixture.js";
import { chipClassDeclaration, rsvpContrast } from "./rsvp-contrast.js";

for (const scene of rsvpScenes) {
  it.effect(
    `selected status dash is visible in ${scene.mode} ${scene.width} ${scene.theme}`,
    () =>
      Effect.gen(function* selectedDashContrast() {
        const model = rsvpChipFixture(scene);

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const parsed = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        const fs = yield* FileSystem.FileSystem;
        const style = document.createElement("style");
        style.textContent = yield* fs.readFileString("src/client/style.css");
        document.head.append(style);

        const sheet = yield* Schema.decodeUnknownEffect(
          Schema.instanceOf(CSSStyleSheet)
        )(style.sheet);

        try {
          const chips = [
            ...parsed.querySelectorAll<HTMLElement>(
              ".event-chip.selected.status-declined,.event-chip.selected.status-unanswered,.event-chip.selected.status-unconfirmed"
            ),
          ];

          expect(chips).toHaveLength(3);

          for (const chip of chips) {
            const border = chipClassDeclaration(chip, sheet, "border-color");
            const fill = chipClassDeclaration(chip, sheet, "background");
            expect(chipClassDeclaration(chip, sheet, "border-style")).toBe(
              "dashed"
            );
            expect(
              rsvpContrast(border, fill),
              `${chip.dataset.eventKey}: ${border} / ${fill}`
            ).toBeGreaterThanOrEqual(3);
          }
        } finally {
          style.remove();
        }
      }).pipe(Effect.provide(NodeServices.layer))
  );
}
