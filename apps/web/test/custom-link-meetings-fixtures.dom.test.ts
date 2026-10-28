import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { AppModel } from "../src/client/app.js";
import { update } from "../src/client/app.js";
import { JoinMeeting } from "../src/client/meetings/commands.js";
import { view } from "../src/features/app.js";
import {
  customMeetingAgenda,
  customMeetingModel,
  customMeetingPreferences,
  customMeetingRoom,
  expectCustomMeetingProjection,
  openCustomMeeting,
} from "./custom-link-meetings-fixture.js";
import { fixtureModel } from "./fixture.js";
import { publishFixtureArtifact } from "./publish-fixture-artifact.js";

it.effect(
  "an uncatalogued description URL must never become a meeting Join target",
  () =>
    Effect.gen(function* rejectArbitraryJoin() {
      const model = customMeetingModel("removed");

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const opened = yield* openCustomMeeting(model);
      const snapshot = customMeetingAgenda(model);
      expect(
        document.querySelector("#upcoming-meeting")?.textContent,
        "an uncatalogued description URL must never become a meeting Join target"
      ).not.toContain("Join meeting");
      expect(
        opened.opened,
        "an uncatalogued description URL must never reach MeetingPort"
      ).toEqual([]);
      expect(snapshot.events[0]?.conferenceUrl).toBeNull();
      expectCustomMeetingProjection(model);
    })
);

it.effect(
  "an owned saved custom link reaches the existing Join command and agenda without a false absence claim",
  () =>
    Effect.gen(function* ownedJoin() {
      const model = customMeetingModel("anchor");

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const opened = yield* openCustomMeeting(model);
      expect(
        opened.requested.commands?.find(
          (command) => command.name === JoinMeeting.name
        )?.args
      ).toEqual(opened.command.args);
      expect(opened.opened).toEqual([customMeetingRoom.link]);
      expect(
        document.querySelector("#upcoming-meeting")?.textContent
      ).toContain("Join meeting");
      expect(
        document.querySelector("#upcoming-meeting")?.textContent
      ).not.toContain("Meeting has no conferencing");
      expect(
        Option.getOrUndefined(
          update(opened.requested.model, opened.finished).model.error
        )
      ).toBeUndefined();
      expectCustomMeetingProjection(model, customMeetingRoom.link);
    })
);

const scenes: readonly ("owned" | "anchor" | "removed" | "foreign")[] = [
  "owned",
  "anchor",
  "removed",
  "foreign",
];

const themes: readonly ("light" | "dark")[] = ["light", "dark"];

it.effect(
  "exports sixteen actual-app custom meeting scenes and owned/foreign native agenda inputs",
  () =>
    Effect.gen(function* exportCustomMeetings() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      for (const scene of scenes) {
        const available = scene === "owned" || scene === "anchor";

        for (const theme of themes) {
          for (const width of [900, 1440]) {
            const base = customMeetingModel(scene);

            const model: AppModel = {
              ...base,
              calendar: {
                ...base.calendar,
                reads: fixtureModel().calendar.reads,
                viewport: 844,
                viewportWidth: width - (width === 900 ? 185 + 260 : 220 + 300),
              },
              settings: { ...base.settings, theme },
            };

            const rendered = yield* renderToString(
              { init: () => ({ model }), view },
              { isHydratable: false }
            );

            const document = new DOMParser().parseFromString(
              rendered.html,
              "text/html"
            );

            const panel = document.querySelector("#upcoming-meeting");
            expect(panel).not.toBeNull();
            expect(panel?.textContent?.includes("Join meeting")).toBe(
              available
            );
            expect(
              panel?.textContent?.includes("Meeting has no conferencing")
            ).toBe(!available);
            expect(panel?.textContent).toContain("Select event");
            const proof = `const panel=document.querySelector('#upcoming-meeting');if(!panel)throw Error('Custom meeting panel missing');const join=[...panel.querySelectorAll('button')].some(button=>button.textContent==='Join meeting');if(join!==${JSON.stringify(available)})throw Error('Wrong custom Join availability');if(panel.textContent.includes('Meeting has no conferencing')!==${JSON.stringify(!available)})throw Error('Wrong conferencing claim');if(document.documentElement.scrollWidth>innerWidth)throw Error('Page overflow');for(const button of panel.querySelectorAll('button')){const box=button.getBoundingClientRect(),parent=panel.getBoundingClientRect();if(box.left<parent.left||box.right>parent.right+1)throw Error('Custom meeting action clipped');}document.documentElement.dataset.customMeetingProof='pass';`;

            const evidence = JSON.stringify({
              conferenceUrl:
                customMeetingAgenda(model).events[0]?.conferenceUrl ?? null,
              expectedJoin: available,
              scene,
            });

            yield* publishFixtureArtifact(
              `../../.git/custom-link-meeting-${scene}-${theme}-${width}-fixture.html`,
              `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Saved custom meeting ${scene}</title><style>${css}</style></head><body>${rendered.html}<script type="application/json" id="custom-meeting-evidence">${evidence}</script><script>${proof}</script></body></html>`
            );
          }
        }
      }

      const owned = customMeetingModel("owned");
      const foreign = customMeetingModel("foreign");
      const ownedAgenda = customMeetingAgenda(owned);
      const foreignAgenda = customMeetingAgenda(foreign);
      expect(ownedAgenda.events[0]?.conferenceUrl).toBe(customMeetingRoom.link);
      expect(foreignAgenda.events[0]?.conferenceUrl).toBeNull();
      yield* fs.writeFileString(
        "../../.git/custom-link-meeting-owned-agenda.json",
        JSON.stringify(ownedAgenda, null, 2)
      );
      yield* fs.writeFileString(
        "../../.git/custom-link-meeting-foreign-agenda.json",
        JSON.stringify(foreignAgenda, null, 2)
      );
      yield* fs.writeFileString(
        "../../.git/custom-link-meeting-agenda-context.json",
        JSON.stringify(
          {
            foreignExpectedUrl: null,
            now: owned.calendar.now,
            ownedExpectedUrl: customMeetingRoom.link,
            preferences: customMeetingPreferences,
          },
          null,
          2
        )
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
