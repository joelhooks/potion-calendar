import { MeetingJoinOutcome } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { keyboardMessage } from "../src/client/keyboard/input.js";
import { JoinMeeting } from "../src/client/meetings/commands.js";
import { JoinSelection } from "../src/client/meetings/model.js";
import { view } from "../src/features/app.js";
import { upcomingMeetingPanel } from "../src/features/upcoming-meeting.js";
import { ShortcutsRoute } from "../src/layout/route.js";
import { meetingModel, savedMeeting } from "./meetings-fixture.js";

const panelView = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.main([], upcomingMeetingPanel(model, h)),
  title: "Meeting panel actions",
});

it.effect(
  "the rendered Join button sends its displayed future target to the shared command",
  () =>
    Effect.sync(() => {
      const model = meetingModel([
        savedMeeting(0, -5, 30),
        savedMeeting(1, 30, 60),
      ]);

      const key = {
        accountId: "work",
        calendarId: "primary",
        eventId: "meeting-1",
      };

      const command = JoinMeeting({
        personId: Option.getOrThrow(model.person),
        selection: JoinSelection.cases.Available.make({
          conferenceUrl: "https://meet.google.com/abc-defg-hij",
          key,
        }),
      });

      Scene.scene(
        { update, view: panelView },
        Scene.given(model),
        Scene.click(Scene.role("button", { name: "Join meeting" })),
        Scene.Command.expectExact(command),
        Scene.Command.resolve(
          command,
          Message.FinishedJoinMeeting({
            outcome: MeetingJoinOutcome.cases.Requested.make({ key }),
            personId: Option.getOrThrow(model.person),
          })
        )
      );
    })
);

it.effect(
  "the rendered Select event button projects details without producing a fetch command",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view: panelView },
        Scene.given(meetingModel([savedMeeting(1, 30, 60)])),
        Scene.click(Scene.role("button", { name: "Select event" })),
        Scene.Command.expectNone(),
        Scene.expect(Scene.selector("#upcoming-meeting")).toBeAbsent()
      );
    })
);

it.effect(
  "shortcut help keeps Mod-J listed even when no meeting can be joined",
  () =>
    Effect.gen(function* shortcutHelp() {
      const base = meetingModel([]);

      const model = {
        ...base,
        route: ShortcutsRoute.make({ section: Option.none() }),
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const dom = new DOMParser().parseFromString(rendered.html, "text/html");

      const row = [...dom.querySelectorAll('[data-shortcut-id="join"]')].find(
        (node) => node.textContent?.includes("Join meeting")
      );

      expect(row).not.toBeUndefined();
      expect(row?.querySelector("kbd")?.textContent).toMatch(/J/u);
    })
);

it.effect(
  "Mod-J does not hijack text fields or an already-handled browser event",
  () =>
    Effect.sync(() => {
      const model = meetingModel([]);
      const input = document.createElement("input");

      document.body.append(input);
      input.focus();

      const typed = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "j",
      });

      input.dispatchEvent(typed);
      expect(
        Option.isNone(
          keyboardMessage(model, typed, model.calendar.now, "Linux")
        )
      ).toBe(true);

      const handled = new KeyboardEvent("keydown", {
        cancelable: true,
        ctrlKey: true,
        key: "j",
      });

      handled.preventDefault();
      expect(
        Option.isNone(
          keyboardMessage(model, handled, model.calendar.now, "Linux")
        )
      ).toBe(true);
      input.remove();
    })
);
