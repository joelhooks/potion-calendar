import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { visibleEvents } from "../src/layout/presentation.js";
import {
  emptyStateFixture,
  emptyStateScenarios,
} from "./empty-states-fixture.js";
import { executeEmptyStateProofWithStandInBoxes } from "./empty-states-proof.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

it.effect(
  "exports twenty actual-app empty/unavailable scenes with geometry and state proofs",
  () =>
    Effect.gen(function* emptyStateArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const scenario of emptyStateScenarios) {
        for (const width of [1440, 900]) {
          for (const theme of ["light", "dark"] as const) {
            const base = emptyStateFixture(scenario);
            const context = scenario !== "empty-week";
            const sidebar = width <= 1000 ? 185 : 220;
            const panelWidth = width <= 1000 ? 260 : 300;
            const panel = context ? panelWidth : 0;

            const model = {
              ...base,
              calendar: {
                ...base.calendar,
                viewport: 844,
                viewportWidth: width - sidebar - panel,
              },
              settings: { ...base.settings, hideContextPanel: !context, theme },
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const document = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            expect(document.querySelectorAll(".day-column")).toHaveLength(7);
            expect(
              document.querySelectorAll(".calendar-read-notice")
            ).toHaveLength(scenario === "refresh-failed" ? 1 : 0);
            expect(
              document.querySelectorAll(".calendar-load-failure")
            ).toHaveLength(scenario === "load-failed" ? 1 : 0);

            if (scenario === "no-conference") {
              expect(
                document.querySelector("#upcoming-meeting")?.textContent
              ).toContain("Meeting has no conferencing");
              expect(
                [...document.querySelectorAll(".event-chip strong")].some(
                  (title) =>
                    title.textContent ===
                    document.querySelector("#upcoming-meeting h2")?.textContent
                )
              ).toBe(true);
              expect(
                document.querySelector("#upcoming-meeting")?.textContent
              ).toContain("Select event");
              expect(
                document.querySelector("#upcoming-meeting")?.textContent
              ).not.toContain("Join meeting");
            }

            if (scenario === "upcoming-empty") {
              expect(
                document.querySelector("#upcoming-meeting")?.textContent
              ).toContain("No upcoming meeting");
            }

            if (scenario === "empty-week") {
              expect(document.querySelectorAll(".event-chip")).toHaveLength(0);
              expect(document.querySelector("#upcoming-meeting")).toBeNull();
              expect(document.body.textContent).not.toContain("No events");
            }

            const proof = `const scenario=${JSON.stringify(scenario)};const assert=(ok,message)=>{if(!ok)throw Error(message)};const box=element=>element.getBoundingClientRect();assert(document.documentElement.scrollWidth<=innerWidth,'Page overflow');const grid=document.querySelector('#time-viewport');const sidebar=document.querySelector('.sidebar');assert(grid&&sidebar,'Grid/sidebar missing');assert(box(grid).width>=400,'Grid too narrow');assert(box(sidebar).right<=box(grid).left+1,'Sidebar overlaps grid');const panel=document.querySelector('#upcoming-meeting');if(scenario==='empty-week'){assert(!panel,'Empty week has invented panel');assert(!document.querySelector('.event-chip'),'Empty week has chips');assert(!grid.textContent.includes('No events'),'Invented empty-week guidance');}else{assert(panel,'Upcoming panel missing');assert(box(panel).right<=innerWidth+1,'Upcoming clipped');assert(Math.abs(box(grid).right-box(panel).left)<=1,'Grid/panel gap');for(const button of panel.querySelectorAll('button')){assert(box(button).left>=box(panel).left&&box(button).right<=box(panel).right,'Upcoming action clipped');}}const notices=[...document.querySelectorAll('.calendar-read-notice')];assert(notices.length===(scenario==='refresh-failed'?1:0),'Wrong refresh notice count');if(notices.length){const notice=notices[0];const stack=notice.closest('.notification-stack');assert(stack,'Shared notice stack missing');assert(Math.abs(box(stack).right-(innerWidth-24))<=1,'Stack not bottom-right aligned');assert(box(stack).bottom<=innerHeight-23,'Stack below viewport');assert(box(notice).left>=0&&box(notice).top>=0,'Notice clipped');assert(notice.textContent.includes("Couldn't refresh Work"),'Wrong refresh wording');assert([...notice.querySelectorAll('button')].some(button=>button.textContent==='Retry'),'No retry');assert(document.querySelectorAll('.event-chip').length>0,'Cached events disappeared');for(const child of stack.children){if(child===notice)continue;const a=box(notice),b=box(child);assert(a.bottom<=b.top||b.bottom<=a.top||a.right<=b.left||b.right<=a.left,'Notice layers overlap');}}const line=document.querySelector('.calendar-load-failure');assert(Boolean(line)===(scenario==='load-failed'),'Wrong load-failure row');if(line){const row=line.closest('.calendar-row');assert(row&&row.textContent.includes("Couldn't load Work"),'Wrong calendar row');assert(box(line).left>=box(sidebar).left&&box(line).right<=box(sidebar).right,'Failure line clipped');assert(row.querySelector('.calendar-load-retry'),'Missing load retry');}if(scenario==='no-conference'){assert(panel.textContent.includes('Meeting has no conferencing'),'Missing no-conference state');assert([...panel.querySelectorAll('button')].some(button=>button.textContent==='Select event'),'Missing Select event');assert(![...panel.querySelectorAll('button')].some(button=>button.textContent.includes('Join')),'Invalid Join');}if(scenario==='upcoming-empty')assert(panel.textContent.includes('No upcoming meeting'),'Missing empty Upcoming');document.documentElement.dataset.emptyStatesProof='pass';`;

            const renderedMeeting = visibleEvents(model).find((item) =>
              item.copies.some(
                (copy) =>
                  copy.source.accountId === "work" &&
                  copy.source.calendarId === "primary" &&
                  copy.source.eventId === "meeting-0"
              )
            );

            const membership =
              scenario === "no-conference"
                ? `delete document.documentElement.dataset.emptyStatesProof;const title=document.querySelector('#upcoming-meeting h2')?.textContent;const meeting=[...document.querySelectorAll('.event-chip')].find(chip=>chip.querySelector('strong')?.textContent===title);assert(meeting,'Upcoming event absent from rendered grid');assert(meeting.dataset.eventKey===${JSON.stringify(renderedMeeting?.key)},'Upcoming/grid identity mismatch');assert(meeting.dataset.contentMode==='compact','Thirty-minute meeting must use the compact content budget');assert(meeting.querySelector('.event-time')?.textContent==='5:35am','Compact meeting start time mismatch');assert(meeting.getAttribute('aria-label')?.includes('5:35am to 6:05am'),'Complete accessible meeting range missing');assert(box(meeting).width>0&&box(meeting).height>0,'Meeting not laid out');assert(box(meeting).left>=box(grid).left&&box(meeting).right<=box(grid).right+1,'Meeting outside visible days');assert(box(meeting).top>=box(grid).top&&box(meeting).bottom<=box(grid).bottom,'Meeting outside visible hours');document.documentElement.dataset.upcomingGridProof='rendered-visible';document.documentElement.dataset.emptyStatesProof='pass';`
                : "";

            const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x960"><title>${scenario} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script>${proof}${membership}</script></body></html>`;
            const path = `../../.git/empty-states-${scenario}-${theme}-${width}-fixture.html`;
            yield* publishFixtureArtifact(path, html);
            const exported = yield* fs.readFileString(path);

            const checked = executeEmptyStateProofWithStandInBoxes(
              exported,
              width
            );

            expect(checked.documentElement.dataset.emptyStatesProof).toBe(
              "pass"
            );

            if (scenario === "no-conference") {
              expect(renderedMeeting).toBeDefined();
              expect(checked.documentElement.dataset.upcomingGridProof).toBe(
                "rendered-visible"
              );

              const wrong = new DOMParser().parseFromString(
                exported,
                "text/html"
              );

              const title = wrong.querySelector("#upcoming-meeting h2");

              if (title === null) {
                throw new Error("Missing fixture panel title");
              }

              title.textContent = "Product review";
              expect(() =>
                executeEmptyStateProofWithStandInBoxes(
                  wrong.documentElement.outerHTML,
                  width
                )
              ).toThrow("Upcoming/grid identity mismatch");
            }
          }
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
