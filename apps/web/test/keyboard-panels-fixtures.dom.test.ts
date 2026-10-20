import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { keyboardFixture } from "./keyboard-fixture.js";

it.effect(
  "exports every calendar-sidebar and context-panel combination at both widths and themes",
  () =>
    Effect.gen(function* panelReviewArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const width of [1440, 900]) {
        const calendarWidth = width <= 1000 ? 185 : 220;
        const contextWidth = width <= 1000 ? 260 : 300;

        for (const theme of ["light", "dark"] as const) {
          for (const left of [true, false]) {
            for (const right of [true, false]) {
              const base = keyboardFixture();

              const sidebarWidth = left ? calendarWidth : 0;
              const panelWidth = right ? contextWidth : 0;

              const model = {
                ...base,
                calendar: {
                  ...base.calendar,
                  viewport: 844,
                  viewportWidth: width - sidebarWidth - panelWidth,
                },
                keyboard: { ...base.keyboard, sidebar: left },
                settings: { ...base.settings, hideContextPanel: !right, theme },
              };

              const rendered = yield* renderToString(
                { init: () => ({ model }), view },
                { isHydratable: false }
              );

              const dom = new DOMParser().parseFromString(
                rendered.html,
                "text/html"
              );

              expect(dom.querySelector(".workspace > .sidebar") !== null).toBe(
                left
              );
              expect(
                dom.querySelector(".workspace > .detail-panel") !== null
              ).toBe(right);
              expect(dom.querySelector("#command-menu-button") !== null).toBe(
                left
              );
              expect(
                dom.querySelectorAll(".event-chip").length
              ).toBeGreaterThan(0);

              const mode = `left-${left ? "shown" : "hidden"}-context-${right ? "shown" : "hidden"}`;
              const proof = `const left=${left};const right=${right};const sidebar=document.querySelector('.workspace > .sidebar');const panel=document.querySelector('.workspace > .detail-panel');const frame=document.querySelector('#time-viewport');if(document.documentElement.scrollWidth>innerWidth)throw Error('Page widened');if(Boolean(sidebar)!==left||Boolean(panel)!==right||!frame)throw Error('Incorrect visible panels');const box=frame.getBoundingClientRect();const start=sidebar?sidebar.getBoundingClientRect().right:0;const end=panel?panel.getBoundingClientRect().left:innerWidth;if(Math.abs(box.left-start)>1||Math.abs(box.right-end)>1)throw Error('Grid leaves blank strip');if(panel){const bounds=panel.getBoundingClientRect();for(const button of panel.querySelectorAll('button')){const item=button.getBoundingClientRect();if(item.right>bounds.right-8||item.left<bounds.left)throw Error('Context action clipped');}}if(!left){for(const control of document.querySelectorAll('body *')){if(getComputedStyle(control).position!=='fixed'||(!control.matches('button,a,input,select,textarea,[role="button"]')&&!control.querySelector('button,a,input,select,textarea,[role="button"]')))continue;const item=control.getBoundingClientRect();if(item.width>0&&item.height>0&&item.left<box.right&&item.right>box.left&&item.top<box.bottom&&item.bottom>box.top)throw Error('Fixed control intersects grid');}}document.documentElement.dataset.panelLayoutProof='pass';`;

              yield* fs.writeFileString(
                `../../.git/rank6-${theme}-${width}-${mode}-fixture.html`,
                `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Panels ${theme} ${width} ${mode}</title><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`
              );
            }
          }
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
