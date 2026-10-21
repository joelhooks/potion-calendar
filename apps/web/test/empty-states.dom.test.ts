import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import type { AppModel, AppMessage } from "../src/client/app.js";
import { Message, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { RefreshEvents } from "../src/client/live/refresh.js";
import { view } from "../src/features/app.js";
import { calendarRefreshNotices } from "../src/features/calendar-read-failures.js";
import { sidebar } from "../src/features/calendar.js";
import { emptyStateFixture, retryFailure } from "./empty-states-fixture.js";

const documentFor = (model: AppModel) =>
  renderToString(
    { init: () => ({ model }), view },
    { isHydratable: false }
  ).pipe(
    Effect.map((rendered) =>
      new DOMParser().parseFromString(rendered.html, "text/html")
    )
  );

const display = (state: AppModel, h: HtmlBuilder<AppMessage>) =>
  h.div([], [sidebar(state, h), ...calendarRefreshNotices(state, h)]);

it.effect(
  "a cached week retains every rendered chip after a failed refresh and shows one bottom-right failure instead of an empty calendar",
  () =>
    Effect.gen(function* cachedWeekFailure() {
      const model = emptyStateFixture("upcoming-empty");
      const before = yield* documentFor(model);
      const refreshed = update(model, Message.ClickedRefresh()).model;

      const failed = update(
        refreshed,
        Message.FailedEvents({
          accountId: "work",
          failure: retryFailure,
          request: refreshed.calendar.rangeRequest,
        })
      ).model;

      const after = yield* documentFor(failed);

      expect(
        [...after.querySelectorAll(".event-chip")].map(
          (chip) => chip.textContent
        )
      ).toEqual(
        [...before.querySelectorAll(".event-chip")].map(
          (chip) => chip.textContent
        )
      );
      expect(after.querySelectorAll(".event-chip").length).toBeGreaterThan(0);
      expect(
        after.querySelectorAll(".notification-stack .calendar-read-notice")
      ).toHaveLength(1);
      expect(
        after.querySelector(".calendar-read-notice")?.textContent
      ).toContain("Couldn't refresh Work");
      expect(after.querySelector(".calendar-load-failure")).toBeNull();
    })
);

it.effect(
  "a no-cache failed load is named in its own sidebar row and is not presented as an empty success",
  () =>
    Effect.gen(function* uncachedLoadFailure() {
      const failed = emptyStateFixture("load-failed");
      expect(
        failed.calendar.reads.every((read) => AsyncData.isFailure(read.events))
      ).toBe(true);
      expect(
        failed.calendar.reads.every((read) => !AsyncData.hasData(read.events))
      ).toBe(true);
      const document = yield* documentFor(failed);

      const line = document.querySelector(
        ".calendar-row .calendar-load-failure"
      );

      expect(line?.textContent).toBe("Couldn't load Work");
      expect(
        line?.parentElement?.querySelector('[role="checkbox"]')?.textContent
      ).toContain("Work");
      expect(document.querySelectorAll(".event-chip")).toHaveLength(0);
      expect(document.querySelector(".calendar-read-notice")).toBeNull();
      expect(
        line?.parentElement?.querySelector(".calendar-load-retry")?.textContent
      ).toBe("Retry");
    })
);

it.effect.each(["refresh-failed", "load-failed"] as const)(
  "%s Retry sends the existing RefreshEvents command, preserving the failure until success",
  (scenario) =>
    Effect.sync(() => {
      const model = emptyStateFixture(scenario);

      Scene.scene(
        { update, view: display },
        Scene.given(model),
        Scene.click(Scene.role("button", { name: "Retry" })),
        Scene.Command.expectHas(RefreshEvents),
        Scene.Command.resolve(
          RefreshEvents,
          Message.ReceivedEvents({
            accountId: "work",
            request: model.calendar.rangeRequest + 1,
            result: {
              events: [],
              versions: [
                { accountId: "work", calendarId: "primary", version: 2 },
              ],
            },
          })
        ),
        Scene.expect(Scene.selector(".calendar-read-notice")).toBeAbsent(),
        Scene.expect(Scene.selector(".calendar-load-failure")).toBeAbsent()
      );
    })
);

it.effect(
  "Upcoming empty and missing conferencing use the observed copy, while loading and failure never claim no meeting",
  () =>
    Effect.gen(function* upcomingAvailability() {
      const empty = yield* documentFor(emptyStateFixture("upcoming-empty"));
      expect(empty.querySelector("#upcoming-meeting")?.textContent).toContain(
        "No upcoming meeting"
      );
      const missing = yield* documentFor(emptyStateFixture("no-conference"));
      expect(missing.querySelector("#upcoming-meeting")?.textContent).toContain(
        "Meeting has no conferencing"
      );
      expect(missing.querySelector("#upcoming-meeting")?.textContent).toContain(
        "Select event"
      );
      expect(
        missing.querySelector("#upcoming-meeting")?.textContent
      ).not.toContain("Join meeting");

      const base = emptyStateFixture("upcoming-empty");

      for (const data of [
        RemoteEvents.Loading(),
        RemoteEvents.Failure({ error: retryFailure }),
        RemoteEvents.Stale({
          data: { events: [], versions: [] },
          error: retryFailure,
        }),
      ]) {
        const document = yield* documentFor({
          ...base,
          upcoming: { ...base.upcoming, data },
        });

        expect(
          document.querySelector("#upcoming-meeting")?.textContent
        ).not.toContain("No upcoming meeting");
        expect(
          document.querySelector("#upcoming-meeting")?.textContent
        ).toContain(
          AsyncData.isLoading(data)
            ? "Loading upcoming meetings…"
            : retryFailure.message
        );
      }

      const clean = yield* documentFor({
        ...emptyStateFixture("empty-week"),
        settings: { ...base.settings, hideContextPanel: true },
      });

      expect(clean.querySelectorAll(".event-chip")).toHaveLength(0);
      expect(clean.querySelectorAll(".day-column")).toHaveLength(7);
      expect(clean.querySelector(".calendar-read-notice")).toBeNull();
      expect(clean.querySelector("#upcoming-meeting")).toBeNull();
      expect(clean.querySelector(".calendar-load-failure")).toBeNull();
      expect(clean.body.textContent).not.toContain("No events");
    })
);
