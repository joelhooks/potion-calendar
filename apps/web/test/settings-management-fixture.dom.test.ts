import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { settingsManagementFixture } from "./settings-management-fixture.js";

it.effect(
  "exports account removal, confirmation, last-account refusal, colour picker and primary-only grids at both widths and themes",
  () =>
    Effect.gen(function* managementArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const width of [1440, 900]) {
        for (const dark of [false, true]) {
          for (const kind of [
            "account",
            "confirm",
            "last",
            "colours",
            "primary",
          ] as const) {
            const model = settingsManagementFixture(kind, dark, width);

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const proof = `const dialog=document.querySelector('#settings-removal-dialog');if(dialog){dialog.showModal();document.querySelector('#settings-removal-cancel')?.focus();}if(document.documentElement.scrollWidth!==innerWidth)throw Error('Page overflow');const picker=document.querySelector('.settings-colour-picker');if(picker&&(picker.getBoundingClientRect().left<0||picker.getBoundingClientRect().right>innerWidth))throw Error('Colour picker overflow');if('${kind}'==='last'&&!document.querySelector('.settings-remove button')?.disabled)throw Error('Last-account control enabled');if('${kind}'==='primary'){const gutter=document.querySelector('.all-day-gutter');if(Math.abs(gutter.getBoundingClientRect().width-46)>0.5)throw Error('Primary gutter widened');if(getComputedStyle(document.querySelector('.all-day-label')).display!=='none')throw Error('Primary caption wraps');const probe=document.createElement('span');probe.style.color='var(--border)';document.querySelector('.app').append(probe);const expected=getComputedStyle(probe).color;probe.remove();if(getComputedStyle(document.querySelector('.all-day')).borderBottomColor!==expected)throw Error('All-day border token differs');}document.documentElement.dataset.settingsManagementProof='pass';`;
            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Settings management fixture</title><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`;
            yield* fs.writeFileString(
              `../../.git/settings-management-${kind}-${dark ? "dark" : "light"}-${width}-fixture.html`,
              html
            );
          }
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
