import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { calendarKey } from "../src/client/calendar-state.js";
import { view } from "../src/features/app.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";
import {
  selectedReadFixture,
  selectedReadScenarios,
} from "./selected-event-read-fixture.js";
import {
  executeSelectedEventReadProofWithStandIns,
  selectedEventReadProofScript,
} from "./selected-event-read-proof.js";

it.effect(
  "exports exact-script selected-event catalog and refusal states at both widths and themes",
  () =>
    Effect.gen(function* selectedReadArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const width of [1440, 900]) {
        for (const theme of ["light", "dark"] as const) {
          for (const scene of selectedReadScenarios) {
            const base = selectedReadFixture(scene);

            const shown = {
              ...base,
              calendar: {
                ...base.calendar,
                viewport: 844,
                viewportWidth: width - (width <= 1000 ? 445 : 520),
              },
              settings: { ...base.settings, theme },
            };

            const { model } = update(
              shown,
              Message.KeyboardAction({ id: "commands" })
            );

            const go = update(
              model,
              Message.KeyboardPick({ id: "go-to-selection" })
            );

            const provider = update(
              model,
              Message.KeyboardPick({ id: "open-in-provider" })
            );

            const command = provider.commands?.find(
              (entry) => entry.name === "OpenProviderOriginal"
            );

            const href = Option.match(
              Schema.decodeUnknownOption(
                Schema.Struct({ href: Schema.String })
              )(command?.args),
              {
                onNone: () => null,
                onSome: (value) => value.href,
              }
            );

            const evidence = {
              afterGo: {
                closed: go.model.keyboard.screen === "closed",
                commands: go.commands?.map((entry) => entry.name) ?? [],
                day: go.model.calendar.navigation.anchor,
                mode: go.model.calendar.navigation.mode,
                saved:
                  go.commands?.some(
                    (entry) => entry.name === "SavePreferences"
                  ) === true,
                selected: go.model.calendar.selected,
                visible: !go.model.calendar.hidden.includes(
                  calendarKey("work", "primary")
                ),
              },
              beforeMode: model.calendar.navigation.mode,
              provider: {
                closed: provider.model.keyboard.screen === "closed",
                commands: provider.commands?.map((entry) => entry.name) ?? [],
                href,
                unchangedCalendar: provider.model.calendar === model.calendar,
              },
              qualification:
                "Exact exported script with labelled DOM stand-in boxes; real geometry and screenshots are desk-qualified. No browser URL is opened during export.",
              scene,
              selected: model.calendar.selected,
              sourceDay: Date.UTC(2026, 9, 19) / 86_400_000,
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const payload = JSON.stringify(evidence).replaceAll("<", "\\u003c");
            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Selected-event read ${scene} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="selected-read-evidence">${payload}</script><script data-selected-read-proof>${selectedEventReadProofScript}</script></body></html>`;
            const path = `../../.git/selected-read-${scene}-${theme}-${width}-fixture.html`;
            yield* publishFixtureArtifact(path, html);
            const exported = yield* fs.readFileString(path);

            const document = executeSelectedEventReadProofWithStandIns(
              exported,
              width
            );

            expect(
              document.documentElement.dataset.selectedEventReadProof
            ).toBe("pass");
          }
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
