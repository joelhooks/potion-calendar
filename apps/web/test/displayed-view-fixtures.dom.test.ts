import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureSelection } from "./fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

it.effect(
  "exports exactly two Displayed view settings pages for fenced review",
  () =>
    Effect.gen(function* displayedViewExports() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const base = fixtureSelection();

      const phone = update(
        base,
        Message.MeasuredShellViewport({ width: 390 })
      ).model;

      const month = update(
        base,
        Message.ClickedView({ days: 7, mode: "month" })
      ).model;

      const scenes = [
        {
          expected: "Day · 1 day",
          height: 844,
          id: "day-dark-390",
          model: phone,
          theme: "dark" as const,
          width: 390,
        },
        {
          expected: "Month",
          height: 900,
          id: "month-light-1440",
          model: month,
          theme: "light" as const,
          width: 1440,
        },
      ];

      const directory = "../../.rat/displayed-view/ui";
      yield* fs.makeDirectory(directory, { recursive: true });

      for (const scene of scenes) {
        const model = {
          ...scene.model,
          route: SettingsRoute.make({ page: "general" }),
          settings: { ...scene.model.settings, theme: scene.theme },
        };

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        const row = [...document.querySelectorAll(".settings-row")].find(
          (item) => item.firstElementChild?.textContent === "Displayed view"
        );

        expect(row?.lastElementChild?.textContent).toBe(
          `${scene.expected}. Change this on the calendar.`
        );

        const proof = `(() => {
          const check = (fact, message) => { if (!fact) throw new Error(message); };
          const dialog = document.querySelector('#phone-settings-dialog');
          if (dialog) {
            check(typeof dialog.showModal === 'function', 'Native modal API is missing');
            dialog.showModal();
            check(dialog.matches(':modal'), 'Phone settings must be a native modal');
          }
          check(document.documentElement.clientWidth === ${scene.width}, 'Wrong CSS viewport width');
          const row = [...document.querySelectorAll('.settings-row')].find(item => item.firstElementChild?.textContent === 'Displayed view');
          check(row?.lastElementChild?.textContent === ${JSON.stringify(`${scene.expected}. Change this on the calendar.`)}, 'Incorrect displayed view');
          check(row.getBoundingClientRect().height > 0, 'Displayed view is not visible');
          check(document.documentElement.scrollWidth <= ${scene.width}, 'Page overflows horizontally');
          document.documentElement.dataset.displayedViewProof = 'pass';
        })();`;

        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${scene.width}x${scene.height}"><title>Settings displayed view ${scene.id}</title><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`;
        const path = `${directory}/settings-general-${scene.id}.html`;
        yield* publishFixtureArtifact(path, html);
        expect(yield* fs.readFileString(path)).toBe(html);
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
