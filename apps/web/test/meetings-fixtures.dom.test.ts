import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import { fixtureModel } from "./fixture.js";
import { meetingModel, savedMeeting } from "./meetings-fixture.js";

it.effect(
  "exports actual-renderer upcoming and permission-spacing fixtures in both widths and themes",
  () =>
    Effect.gen(function* meetingReviewArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const width of [1440, 900]) {
        for (const theme of ["light", "dark"] as const) {
          const sidebar = width <= 1000 ? 185 : 220;
          const panel = width <= 1000 ? 260 : 300;

          const base = meetingModel([
            savedMeeting(0, 35, 65, { title: "Saved team meeting" }),
          ]);

          const model = {
            ...base,
            calendar: {
              ...base.calendar,
              reads: fixtureModel().calendar.reads,
              viewport: 844,
              viewportWidth: width - sidebar - panel,
            },
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

          expect(dom.querySelector("#upcoming-meeting")?.textContent).toContain(
            "Saved team meeting"
          );
          expect(dom.querySelectorAll(".event-chip").length).toBeGreaterThan(0);
          const proof = `const panel=document.querySelector('#upcoming-meeting');const frame=document.querySelector('#time-viewport');if(document.documentElement.scrollWidth>innerWidth)throw Error('Page widened');if(!panel||!frame)throw Error('Missing panel or grid');const box=panel.getBoundingClientRect();if(box.width<250||box.right>innerWidth+1)throw Error('Panel clipped');if(Math.abs(frame.getBoundingClientRect().right-box.left)>1)throw Error('Grid leaves blank strip');for(const button of panel.querySelectorAll('button')){const item=button.getBoundingClientRect();if(item.right>box.right-8||item.left<box.left)throw Error('Meeting action clipped');}document.documentElement.dataset.meetingLayoutProof='pass';`;
          const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Upcoming meeting ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`;

          yield* fs.writeFileString(
            `../../.git/joining-${theme}-${width}-fixture.html`,
            html
          );

          const notifications = yield* renderToString(
            {
              init: () => ({
                model: {
                  ...model,
                  route: SettingsRoute.make({ page: "notifications" }),
                },
              }),
              view,
            },
            { isHydratable: false }
          );

          const notificationDom = new DOMParser().parseFromString(
            notifications.html,
            "text/html"
          );

          expect(
            notificationDom
              .querySelector('#browser-notification-permission [role="status"]')
              ?.parentElement?.classList.contains("settings-row")
          ).toBe(true);
          yield* fs.writeFileString(
            `../../.git/joining-notifications-${theme}-${width}-fixture.html`,
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Notifications ${theme} ${width}</title><style>${css}</style></head><body>${notifications.html}</body></html>`
          );
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
