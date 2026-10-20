import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Match, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { ClipboardView } from "../src/client/clipboard/model.js";
import { view } from "../src/features/app.js";
import { clipboardGuestFixture } from "./clipboard-root-fixture.js";

it.effect(
  "exports actual root clipboard decisions and status with shared CSS at both widths and themes",
  () =>
    Effect.gen(function* clipboardArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const state of [
        "guests",
        "incomplete",
        "failure",
        "copied",
      ] as const) {
        const base = clipboardGuestFixture(
          state !== "incomplete",
          state === "incomplete" ? 0 : 1
        );

        const common = {
          copied: base.clipboard.view.copied,
          toast: Option.none(),
        };

        const projection = Match.value(state).pipe(
          Match.when("failure", () =>
            ClipboardView.cases.Failure.make({
              ...common,
              intentId: "paste-intent",
              message:
                "The event could not be created. Check the calendar and retry.",
              retryable: true,
            })
          ),
          Match.when("copied", () =>
            ClipboardView.cases.Idle.make({
              ...common,
              toast: Option.some({
                id: "copy-toast",
                message:
                  "Copied event. Repeat and native conferencing are not copied.",
              }),
            })
          ),
          Match.orElse(() => base.clipboard.view)
        );

        for (const width of [1440, 900]) {
          for (const theme of ["light", "dark"] as const) {
            const model = {
              ...base,
              calendar: { ...base.calendar, viewportWidth: width - 520 },
              clipboard: { ...base.clipboard, view: projection },
              settings: { ...base.settings, theme },
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const dom = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            expect(
              dom.querySelector(
                state === "guests" || state === "incomplete"
                  ? "#clipboard-guests"
                  : ".clipboard-toast"
              )
            ).not.toBeNull();
            const proof = `const dialog=document.querySelector('#clipboard-guests');if(dialog){dialog.showModal();document.querySelector('#clipboard-exclude')?.focus();const box=dialog.getBoundingClientRect();if(box.left<0||box.right>innerWidth||box.top<0||box.bottom>innerHeight)throw Error('Dialog overflow');for(const control of dialog.querySelectorAll('button')){const b=control.getBoundingClientRect();if(b.left<box.left||b.right>box.right||b.top<box.top||b.bottom>box.bottom)throw Error('Control clipped');}const invite=[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Invite guests (sends email)');if(!invite||invite.disabled!==${state === "incomplete"})throw Error('Consent state incorrect');if(document.activeElement?.id!=='clipboard-exclude')throw Error('Default focus incorrect');}else{const toast=document.querySelector('.clipboard-toast');const luminance=color=>{const values=color.match(/[\\d.]+/g)?.slice(0,3).map(Number);if(!values||values.length!==3)throw Error('Unknown computed colour');return values.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);};const style=getComputedStyle(toast);const foreground=luminance(style.color);const background=luminance(style.backgroundColor);const contrast=(Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);if(contrast<4.5)throw Error('Toast contrast below AA: '+contrast);document.documentElement.dataset.clipboardContrast=String(contrast);const box=toast?.getBoundingClientRect();if(!box||box.left<0||box.right>innerWidth||box.top<0||box.bottom>innerHeight)throw Error('Toast overflow');}if(document.documentElement.scrollWidth>innerWidth)throw Error('Page overflow');document.documentElement.dataset.clipboardProof='pass';`;
            yield* fs.writeFileString(
              `../../.git/clipboard-${state}-${theme}-${width}-fixture.html`,
              `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Clipboard ${state} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`
            );
          }
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
