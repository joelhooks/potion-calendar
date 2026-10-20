// @effect-diagnostics-next-line nodeBuiltinImport:off -- Review artifacts carry SHA-256 hashes in their local fixture manifest.
import { createHash } from "node:crypto";

import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { AppModel } from "../src/client/app.js";
import { RemoteDesktop, initialDesktop } from "../src/client/desktop/model.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";

it.effect(
  "exports desktop and plain-web settings in both themes and widths with a live layout proof",
  () =>
    Effect.gen(function* desktopSettingsFixtures() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const manifest: {
        file: string;
        mode: string;
        page: string;
        theme: string;
        width: number;
        height: number;
        sha256: string;
      }[] = [];

      for (const width of [1440, 900]) {
        for (const theme of ["light", "dark"] as const) {
          for (const page of [
            "general",
            "menu-bar",
            "notifications",
          ] as const) {
            for (const native of [true, false]) {
              const base = fixtureModel();

              const model: AppModel = {
                ...base,
                desktop: {
                  ...initialDesktop(),
                  availability: native ? "available" : "unavailable",
                  settings: native
                    ? RemoteDesktop.Success({
                        data: {
                          issues: [],
                          openAtLogin: false,
                          preferences: defaultDesktopPreferences(),
                          revision: 1,
                        },
                      })
                    : RemoteDesktop.Idle(),
                },
                route: SettingsRoute.make({ page }),
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

              const selector = {
                general: "#desktop-open-calendar",
                "menu-bar": "#desktop-menu-bar",
                notifications: "#desktop-prompt-minutes",
              }[page];

              expect(dom.querySelector(selector) !== null).toBe(native);
              expect(
                dom.querySelector('a[href="/settings/menu-bar"]') !== null
              ).toBe(native);

              if (!native) {
                expect(dom.querySelectorAll('[id^="desktop-"]').length).toBe(0);
              } else if (page === "general") {
                expect(
                  dom.querySelector("#desktop-open-calendar")?.tagName
                ).toBe("SELECT");
              } else if (page === "menu-bar") {
                expect(
                  dom.querySelectorAll(".desktop-shortcut-controls")
                ).toHaveLength(2);
                expect(
                  [...dom.querySelectorAll(".desktop-shortcut-setting")]
                    .at(-1)
                    ?.nextElementSibling?.classList.contains(
                      "desktop-shortcut-status"
                    )
                ).toBe(true);

                for (const id of [
                  "menu-bar",
                  "includeAllDay",
                  "includeWithoutParticipants",
                  "includeWithoutConferencingOrLocation",
                  "showTitle",
                  "showTime",
                ]) {
                  const control = dom.querySelector(`#desktop-${id}`);
                  expect(control?.tagName).toBe("SELECT");
                  expect(
                    [...(control?.querySelectorAll("option") ?? [])].map(
                      (option) => option.value
                    )
                  ).toEqual(["on", "off"]);
                }
              }

              const mode = native ? "desktop" : "web";

              const proof = `
const native=${native};
const selector=${JSON.stringify(selector)};
const content=document.querySelector('.settings-content');
if(document.documentElement.scrollWidth>innerWidth)throw Error('Settings page widened');
if(!content)throw Error('Missing settings content');
if(Boolean(document.querySelector(selector))!==native)throw Error('Incorrect native settings visibility');
if(!native&&document.querySelector('[id^="desktop-"]'))throw Error('Desktop-only rows rendered on web');
const panel=content.getBoundingClientRect();
if(panel.left<0||panel.right>innerWidth+1)throw Error('Settings content clipped');
for(const control of content.querySelectorAll('input,select,button')){
  const box=control.getBoundingClientRect();
  if(box.width>0&&(box.left<panel.left-1||box.right>panel.right+1))throw Error('Settings control clipped');
}
const selects=[...content.querySelectorAll('select[id^="desktop-"]')];
const reference=selects[0]?.getBoundingClientRect();
for(const select of selects){
  if(Math.abs(select.getBoundingClientRect().right-reference.right)>1)throw Error('Native control right edges differ');
}
const groups=[...content.querySelectorAll('.desktop-shortcut-controls')];
if(native&&selector==='#desktop-menu-bar'&&groups.length!==2)throw Error('Missing shortcut rows');
for(const group of groups){
  const box=group.getBoundingClientRect();
  if(!reference||Math.abs(box.right-reference.right)>1)throw Error('Shortcut group right edge differs');
  if(getComputedStyle(group).columnGap!=='8px')throw Error('Shortcut gap differs');
  const controls=[...group.querySelectorAll('input,button')];
  if(controls.length!==3)throw Error('Incorrect shortcut controls');
  for(let index=0;index<controls.length;index++){
    const item=controls[index].getBoundingClientRect();
    const first=groups[0].querySelectorAll('input,button')[index].getBoundingClientRect();
    if(Math.abs(item.left-first.left)>1||Math.abs(item.width-first.width)>1)throw Error('Shortcut columns differ');
    if(Math.abs(item.height-reference.height)>1||Math.abs(item.top-box.top)>1)throw Error('Shortcut heights or alignment differ');
  }
  const input=group.querySelector('input');
  const style=getComputedStyle(input);
  for(const side of ['Top','Right','Bottom','Left']){
    if(parseFloat(style['border'+side+'Width'])!==1||style['border'+side+'Style']!=='solid')throw Error('Shortcut input border differs');
  }
  if(parseFloat(style.borderRadius)!==5)throw Error('Shortcut input radius differs');
}
document.documentElement.dataset.desktopSettingsLayoutProof='pass';`;

              const file = `desktop-settings-${mode}-${theme}-${width}-${page}-fixture.html`;
              const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Desktop settings ${mode} ${page} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`;
              yield* fs.writeFileString(`../../.git/${file}`, html);
              manifest.push({
                file,
                height: 900,
                mode,
                page,
                sha256: createHash("sha256").update(html).digest("hex"),
                theme,
                width,
              });
            }
          }
        }
      }

      expect(manifest).toHaveLength(24);
      yield* fs.writeFileString(
        "../../.git/desktop-settings-fixture-manifest.json",
        JSON.stringify({ fixtures: manifest, schemaVersion: 1 }, null, 2)
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
