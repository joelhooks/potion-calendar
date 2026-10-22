import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { view } from "../src/features/app.js";
import { icsExportFixture } from "./ics-export-fixture.js";
import {
  executeIcsExportProofWithStandIns,
  icsExportProofScript,
} from "./ics-export-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

it.effect(
  "exports four exact-script actual-root ICS catalog scenes at both widths and themes",
  () =>
    Effect.gen(function* icsExportScenes() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const manifest: {
        file: string;
        width: number;
        height: number;
        theme: string;
      }[] = [];

      for (const width of [900, 1440]) {
        for (const theme of ["light", "dark"] as const) {
          const base = icsExportFixture(true);

          const shown = {
            ...base,
            calendar: {
              ...base.calendar,
              viewport: 900,
              viewportWidth: width - (width <= 1000 ? 445 : 520),
            },
            settings: { ...base.settings, theme },
          };

          const opened = update(
            shown,
            Message.KeyboardAction({ id: "commands" })
          ).model;

          const model = {
            ...opened,
            keyboard: { ...opened.keyboard, query: "Export" },
          };

          const picked = update(
            model,
            Message.KeyboardPick({ id: "export-ics" })
          );

          const args = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ events: Schema.Array(Schema.Unknown) })
          )(picked.commands?.[0]?.args);

          const evidence = {
            calendarUnchanged: picked.model.calendar === model.calendar,
            closed: picked.model.keyboard.screen === "closed",
            commands: picked.commands?.map((command) => command.name) ?? [],
            exportedCount: args.events.length,
            kind: "stand-in dispatch; no browser download or provider call",
            selectedCount: model.calendar.selected.length,
          };

          const rendered = yield* renderToString(
            { init: () => ({ model }), view },
            { isHydratable: false }
          );

          const payload = JSON.stringify(evidence).replaceAll("<", "\\u003c");
          const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x960"><title>ICS export ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="ics-export-evidence">${payload}</script><script data-ics-export-proof>${icsExportProofScript}</script></body></html>`;
          const file = `ics-export-${theme}-${width}-fixture.html`;
          yield* publishFixtureArtifact(`../../.git/${file}`, html);
          const exported = yield* fs.readFileString(`../../.git/${file}`);
          expect(
            executeIcsExportProofWithStandIns(exported, width).documentElement
              .dataset.icsExportProof
          ).toBe("pass");
          manifest.push({ file, height: 960, theme, width });
        }
      }

      yield* publishFixtureArtifact(
        "../../.git/ics-export-fixtures-manifest.json",
        JSON.stringify({ scenes: manifest }, null, 2)
      );
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "the exported ICS proof rejects missing entries, wrong selected counts and server commands",
  () =>
    Effect.sync(() => {
      const base =
        '<dialog id="keyboard-command-dialog"><button id="command-export-ics">Export as .ics</button></dialog>';

      const good = {
        calendarUnchanged: true,
        closed: true,
        commands: ["DownloadSelectedIcs"],
        exportedCount: 2,
        kind: "stand-in dispatch; no browser download or provider call",
        selectedCount: 2,
      };

      for (const [markup, evidence, reason] of [
        [
          base.replace('id="command-export-ics"', 'id="absent"'),
          good,
          "Missing enabled ICS",
        ],
        [base, { ...good, selectedCount: 0 }, "Wrong multi-selection"],
        [base, { ...good, commands: ["ReadEvents"] }, "single local command"],
      ] as const) {
        const html = `${markup}<script type="application/json" id="ics-export-evidence">${JSON.stringify(evidence)}</script><script data-ics-export-proof>${icsExportProofScript}</script>`;
        expect(() => executeIcsExportProofWithStandIns(html, 900)).toThrow(
          reason
        );
      }
    })
);
