import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { view } from "../src/features/app.js";
import { notificationSettingsFixture } from "./notification-settings-fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

const fixtures = [
  { scene: "unknown", theme: "light", width: 900 },
  { scene: "unknown", theme: "dark", width: 900 },
  { scene: "unknown", theme: "light", width: 1440 },
  { scene: "unknown", theme: "dark", width: 1440 },
  { scene: "menu-off", theme: "light", width: 900 },
  { scene: "menu-off", theme: "dark", width: 1440 },
  { scene: "pending", theme: "dark", width: 900 },
  { scene: "failed", theme: "light", width: 1440 },
  { scene: "granted", theme: "light", width: 900 },
  { scene: "denied", theme: "dark", width: 1440 },
  { scene: "default", theme: "dark", width: 900 },
  { scene: "default", theme: "dark", width: 390 },
] as const;

for (const { scene, theme, width } of fixtures) {
  it.effect(
    `exports notification settings ${scene} ${theme} ${width} through the actual settings recipient`,
    () =>
      Effect.gen(function* notificationSettingsExport() {
        const fs = yield* FileSystem.FileSystem;
        const css = yield* fs.readFileString("src/client/style.css");
        const base = notificationSettingsFixture(scene);

        const { model } = update(
          {
            ...base,
            calendar: { ...base.calendar, viewportWidth: width },
            settings: { ...base.settings, theme },
          },
          Message.MeasuredShellViewport({ width })
        );

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const dom = new DOMParser().parseFromString(rendered.html, "text/html");

        const native =
          scene === "unknown" ||
          scene === "menu-off" ||
          scene === "pending" ||
          scene === "failed";

        expect(
          dom.querySelector("#desktop-notification-settings-open") !== null
        ).toBe(native);

        if (native) {
          expect(dom.body.textContent).toContain(
            "Permission status: Check System Settings"
          );
          expect(dom.body.textContent).toContain(
            "Do Not Disturb or Focus can hide alerts."
          );
          expect(
            dom
              .querySelector("#desktop-notification-settings-open")
              ?.hasAttribute("disabled")
          ).toBe(scene === "pending");
        }

        if (scene === "menu-off") {
          expect(dom.body.textContent).toContain(
            "Desktop reminders and upcoming-meeting notifications will not appear."
          );
          expect(
            dom
              .querySelector("#desktop-prompt-minutes")
              ?.hasAttribute("disabled")
          ).toBe(true);
        }

        if (width === 390) {
          expect(dom.querySelector("#phone-settings-dialog")).not.toBeNull();
          expect(dom.body.textContent).toContain(
            "Browser notifications are not yet enabled."
          );
        }

        const proof = `const dialog=document.querySelector('#phone-settings-dialog');if(dialog&&!dialog.open)dialog.showModal();if(document.documentElement.scrollWidth>innerWidth)throw Error('Notification settings overflow');const root=document.querySelector('.settings-content');if(!root)throw Error('Missing Notifications recipient');for(const element of root.querySelectorAll('button,select')){const r=element.getBoundingClientRect();if(r.width&&(r.left<0||r.right>innerWidth+1))throw Error('Notification control clipped');}document.documentElement.dataset.notificationSettingsProof='pass';`;

        const spacingProof = native
          ? `const mac=document.querySelector('section[aria-label="macOS notifications"]');const content=mac?.querySelector('.settings-conferencing-entry');const actions=mac?.querySelector('.settings-calendar-actions');if(!content||!actions)throw Error('Missing native spacing recipient');for(const group of [content,...content.querySelectorAll('.settings-conferencing-entry')]){const blocks=[...group.children].map(node=>node.getBoundingClientRect()).filter(r=>r.width&&r.height);for(let i=1;i<blocks.length;i++){if(blocks[i].top-blocks[i-1].bottom<5.5)throw Error('Native notification text spacing collapsed');}}const buttons=[...actions.querySelectorAll('button')].map(node=>node.getBoundingClientRect()).filter(r=>r.width&&r.height);for(let i=1;i<buttons.length;i++){const previous=buttons[i-1],next=buttons[i];const sameRow=Math.min(previous.bottom,next.bottom)>Math.max(previous.top,next.top);const gap=sameRow?next.left-previous.right:next.top-previous.bottom;if(gap<8)throw Error('Native notification buttons have less than eight pixels separation');}document.documentElement.dataset.notificationSettingsSpacingProof='pass';`
          : "";

        const file = `../../.git/notification-settings-${scene}-${theme}-${width}-fixture.html`;
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="fixture-viewport" content="${width}x900"><title>Notification settings ${scene} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script>${proof}${spacingProof}</script></body></html>`;
        yield* publishFixtureArtifact(file, html);
        expect(yield* fs.readFileString(file)).toBe(html);
      }).pipe(Effect.provide(NodeServices.layer))
  );
}
