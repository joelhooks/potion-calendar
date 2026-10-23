import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import {
  phoneCreatorFixture,
  phoneCreatorProofScript,
} from "./phone-creator-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

it.effect(
  "exports one actual-root light 390px creator details sheet with distinct participant roles",
  () =>
    Effect.gen(function* phoneCreatorExport() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const model = phoneCreatorFixture();

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = document.createElement("div");
      root.innerHTML = rendered.html;
      const dialog = root.querySelector("[data-phone-shell-dialog]");
      const rows = [...(dialog?.querySelectorAll(".detail-panel ul li") ?? [])];

      expect(model.phoneShell).toEqual({ mode: "details", viewportWidth: 390 });
      expect(model.calendar.navigation.mode).toBe("day");
      expect(model.calendar.viewportWidth).toBe(390);
      expect(dialog?.querySelector("header h2")?.textContent).toBe(
        "Design planning"
      );
      expect(
        rows.map((row) => row.textContent),
        "Phone creator retains participant identities and roles"
      ).toEqual([
        "Alex Rivera · OrganizerYes",
        "Blair Chen · You · Creator · OptionalMaybe",
        "Casey QuinnNot answered",
      ]);
      expect(dialog?.textContent).not.toContain("Created by ");
      expect(root.querySelectorAll(".workspace > .detail-panel")).toHaveLength(
        0
      );
      expect(dialog?.querySelectorAll(".detail-panel h2")).toHaveLength(0);

      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="390x844"><title>Phone creator light 390</title><style>${css}</style></head><body>${rendered.html}<script data-phone-creator-proof>${phoneCreatorProofScript}</script></body></html>`;

      const directory = "../../.rat/participant-creator/ui";
      yield* fs.makeDirectory(directory, { recursive: true });
      const file = `${directory}/phone-creator-light-390.html`;

      yield* publishFixtureArtifact(file, html);
      expect(yield* fs.readFileString(file)).toBe(html);
    }).pipe(Effect.provide(NodeServices.layer))
);
