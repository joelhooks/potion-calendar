import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import { reminderSnoozeFixture } from "./reminder-snooze-fixture.js";
import { reminderSnoozeProof } from "./reminder-snooze-proof.js";

const scenes = [
  {
    cards: 1,
    failed: false,
    file: "reminder-snooze-menu-light-1440-fixture.html",
    height: 900,
    started: false,
    theme: "light",
    width: 1440,
  },
  {
    cards: 1,
    failed: false,
    file: "reminder-snooze-menu-started-dark-900-fixture.html",
    height: 900,
    started: true,
    theme: "dark",
    width: 900,
  },
  {
    cards: 3,
    failed: false,
    file: "reminder-snooze-menu-phone-light-390-fixture.html",
    height: 844,
    started: false,
    theme: "light",
    width: 390,
  },
  {
    cards: 1,
    failed: true,
    file: "reminder-snooze-menu-failed-light-900-fixture.html",
    height: 900,
    started: false,
    theme: "light",
    width: 900,
  },
] as const;

for (const scene of scenes) {
  it.effect(`exports P26 ${scene.file} through the actual root renderer`, () =>
    Effect.gen(function* snoozeExport() {
      const model = reminderSnoozeFixture(
        scene.theme,
        scene.width,
        scene.started,
        scene.failed
      );

      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      const disclosures = [...root.querySelectorAll("details.reminder-snooze")];
      const last = disclosures.at(-1);

      const labels = [
        "1 minute",
        "5 minutes",
        "15 minutes",
        "30 minutes",
        "60 minutes",
        "1440 minutes",
        ...(scene.started ? [] : ["Until start"]),
      ];

      expect(disclosures).toHaveLength(scene.cards);
      expect(
        [...(last?.querySelectorAll("button") ?? [])].map(
          (button) => button.textContent
        )
      ).toEqual(labels);
      expect(last?.querySelector("summary")?.textContent).toBe("Snooze");
      expect(
        [...(last?.querySelectorAll("button") ?? [])].every(
          (button) => !button.disabled
        )
      ).toBe(true);
      expect(
        last?.textContent?.includes("Snoozes won't be kept after a reload.")
      ).toBe(scene.failed);
      last?.setAttribute("open", "");
      const evidence = { ...scene, labels };
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="fixture-viewport" content="${scene.width}x${scene.height}"><title>P26 Reminder snooze</title><style>${css}</style></head><body>${root.body.innerHTML}<script type="application/json" id="reminder-snooze-evidence">${JSON.stringify(evidence)}</script><script data-reminder-snooze-proof>${reminderSnoozeProof}</script></body></html>`;
      const directory = "../../.rat/reminder-snooze-followup/ui";

      yield* fs.makeDirectory(directory, { recursive: true });
      yield* publishFixtureArtifact(`${directory}/${scene.file}`, html);
      expect(yield* fs.readFileString(`${directory}/${scene.file}`)).toBe(html);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
}
