import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { upcomingMeetingPanel } from "../src/features/upcoming-meeting.js";
import { customMeetingModel } from "./custom-link-meetings-fixture.js";
import { meetingModel, savedMeeting } from "./meetings-fixture.js";

const panelDocument = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.main([], upcomingMeetingPanel(model, h)),
  title: "Upcoming meeting test",
});

const render = (model: AppModel) =>
  renderToString(
    { init: () => ({ model }), view: panelDocument },
    { isHydratable: false }
  ).pipe(
    Effect.map((document) =>
      new DOMParser().parseFromString(document.html, "text/html")
    )
  );

it.effect(
  "the panel recognises owned plain and HTML custom links but never a removed or foreign catalog link",
  () =>
    Effect.gen(function* customPanel() {
      for (const scene of [
        "owned",
        "anchor",
        "removed",
        "foreign",
      ] satisfies readonly Parameters<typeof customMeetingModel>[0][]) {
        const dom = yield* render(customMeetingModel(scene));
        const panel = dom.querySelector("#upcoming-meeting");
        const available = scene === "owned" || scene === "anchor";
        expect(panel?.textContent?.includes("Join meeting")).toBe(available);
        expect(
          panel?.textContent?.includes("Meeting has no conferencing")
        ).toBe(!available);
        expect(panel?.textContent).toContain("Select event");
      }
    })
);

it.effect(
  "a saved participant meeting without conferencing offers selection rather than a fake join",
  () =>
    Effect.gen(function* missingConference() {
      const model = meetingModel([
        savedMeeting(0, 30, 60, { conferenceUrl: undefined }),
        savedMeeting(1, 60, 90),
      ]);

      const dom = yield* render(model);
      const panel = dom.querySelector("#upcoming-meeting");

      expect(panel?.textContent).toContain("Meeting 0");
      expect(panel?.textContent).toContain("Meeting has no conferencing");
      expect(panel?.textContent).toContain("Select event");
      expect(
        [...dom.querySelectorAll("button")].some(
          (button) => button.textContent === "Join meeting"
        )
      ).toBe(false);
    })
);

it.effect(
  "the future panel excludes the running meeting and uses the shared clock format",
  () =>
    Effect.gen(function* futureMeeting() {
      const base = meetingModel([
        savedMeeting(0, -3, 30),
        savedMeeting(1, 30, 60),
      ]);

      const dom = yield* render({
        ...base,
        settings: { ...base.settings, timeFormat: "24" },
      });

      expect(
        dom.querySelector("#upcoming-meeting")?.getAttribute("aria-label")
      ).toBe("Meeting 1");
      expect(dom.querySelector("#upcoming-meeting h2")?.textContent).toBe(
        "Meeting 1"
      );
      expect(dom.querySelector(".upcoming-label")?.textContent).toBe(
        "Upcoming meeting"
      );
      expect(dom.querySelector("#upcoming-meeting")?.textContent).not.toContain(
        "Meeting 0"
      );
      expect(dom.querySelector(".detail-time")?.textContent).toContain("12:30");
      expect(
        [...dom.querySelectorAll("button")].map((button) => button.textContent)
      ).toEqual(["Join meeting", "Select event"]);
    })
);

it.effect(
  "only an accepted empty read proves the empty state, not loading or failure",
  () =>
    Effect.gen(function* readStates() {
      const base = meetingModel([]);
      const empty = yield* render(base);

      expect(empty.querySelector("#upcoming-meeting")?.textContent).toContain(
        "No upcoming meeting"
      );

      const loading = yield* render({
        ...base,
        upcoming: { ...base.upcoming, data: RemoteEvents.Loading() },
      });

      expect(loading.body.textContent).toContain("Loading upcoming meetings");
      expect(loading.body.textContent).not.toContain("No upcoming meeting");

      const failed = yield* render({
        ...base,
        upcoming: {
          ...base.upcoming,
          data: RemoteEvents.Failure({
            error: { kind: "retry", message: "Saved meetings are unavailable" },
          }),
        },
      });

      expect(failed.body.textContent).toContain(
        "Saved meetings are unavailable"
      );
      expect(failed.body.textContent).not.toContain("No upcoming meeting");

      const stale = yield* render({
        ...base,
        upcoming: {
          ...base.upcoming,
          data: RemoteEvents.Stale({
            data: { events: [], versions: [] },
            error: {
              kind: "retry",
              message: "Could not refresh saved meetings",
            },
          }),
        },
      });

      expect(stale.body.textContent).toContain(
        "Could not refresh saved meetings"
      );
      expect(stale.body.textContent).not.toContain("No upcoming meeting");
    })
);
