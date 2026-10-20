import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Option } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import { view } from "../src/features/app.js";
import { fixtureModel } from "./fixture.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingPerson,
} from "./upcoming-fixture.js";

const render = (model: AppModel) =>
  renderToString({ init: () => ({ model }), view }, { isHydratable: false });

const dom = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

it.effect(
  "live re-reads retain account rows and event chips until the saved replacement arrives",
  () =>
    Effect.gen(function* retainedGrid() {
      const base = fixtureModel();
      const before = yield* render(base);

      const chips = [...dom(before.html).querySelectorAll(".event-chip")].map(
        (chip) => chip.outerHTML
      );

      expect(chips.length).toBeGreaterThan(0);

      const next = update(
        base,
        Message.ReceivedLive({
          notice: LiveNotice.cases.CalendarChanged.make({
            change: {
              accountId: "work",
              calendarId: "primary",
              reason: "sync",
              version: 2,
            },
          }),
          personId: Option.getOrThrow(base.person),
        })
      ).model;

      expect(next.calendar.reads.length).toBeGreaterThan(0);

      for (const read of next.calendar.reads) {
        expect(AsyncData.isRefreshing(read.events)).toBe(true);
        expect(AsyncData.getData(read.events)).toEqual(
          AsyncData.getData(
            base.calendar.reads.find((old) => old.accountId === read.accountId)
              ?.events ?? RemoteEvents.Idle()
          )
        );
      }

      const during = yield* render(next);
      expect(
        [...dom(during.html).querySelectorAll(".event-chip")].map(
          (chip) => chip.outerHTML
        )
      ).toEqual(chips);
      const repeated = update(next, Message.ClickedRefresh()).model;
      expect(
        repeated.calendar.reads.every((read) =>
          AsyncData.isRefreshing(read.events)
        )
      ).toBe(true);
    })
);

it.effect(
  "disjoint navigation loads a new grid while overlapping navigation retains saved rows",
  () =>
    Effect.gen(function* rangeNavigation() {
      const base = fixtureModel();

      const moved = update(
        base,
        Message.KeyboardDate({ day: base.calendar.navigation.anchor + 60 })
      ).model;

      expect(moved.calendar.reads.length).toBeGreaterThan(0);
      expect(
        moved.calendar.reads.every((read) => AsyncData.isLoading(read.events))
      ).toBe(true);
      const rendered = yield* render(moved);
      expect(dom(rendered.html).querySelectorAll(".event-chip")).toHaveLength(
        0
      );

      const overlap = update(
        base,
        Message.ClickedView({ days: 1, mode: "day" })
      ).model;

      expect(
        overlap.calendar.reads.every((read) =>
          AsyncData.isRefreshing(read.events)
        )
      ).toBe(true);
    })
);

it.effect(
  "accounts with no saved rows remain Loading during a same-range reload",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();

      const next = update(
        {
          ...base,
          calendar: {
            ...base.calendar,
            reads: base.calendar.reads.map((read) => ({
              ...read,
              events: RemoteEvents.Loading(),
            })),
          },
        },
        Message.ClickedRefresh()
      ).model;

      expect(next.calendar.reads.length).toBeGreaterThan(0);
      expect(
        next.calendar.reads.every((read) => AsyncData.isLoading(read.events))
      ).toBe(true);
    })
);

it.effect(
  "upcoming Refreshing preserves identical panel markup for saved meetings and empty results and exports both states",
  () =>
    Effect.gen(function* stablePanel() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const base = upcomingFixture();

      const event: CalendarEventValue = {
        ...savedUpcomingEvent,
        attendees: [
          {
            email: "owner@example.test",
            responseStatus: "accepted",
            self: true,
          },
          { email: "guest@example.test", responseStatus: "accepted" },
        ],
        conferenceUrl: "https://meet.google.com/abc-defg-hij",
        end: {
          dateTime: DateTime.formatIso(
            DateTime.makeUnsafe(base.calendar.now + 50 * 60_000)
          ),
        },
        start: {
          dateTime: DateTime.formatIso(
            DateTime.makeUnsafe(base.calendar.now + 20 * 60_000)
          ),
        },
      };

      for (const events of [[event], []]) {
        const data = { events, versions: [] };

        const saved = update(
          base,
          Message.ReceivedUpcoming({
            personId: upcomingPerson,
            request: base.upcoming.request,
            result: data,
          })
        ).model;

        const refreshing = {
          ...saved,
          upcoming: {
            ...saved.upcoming,
            data: RemoteEvents.Refreshing({ data }),
          },
        };

        const success = yield* render(saved);
        const active = yield* render(refreshing);
        const panel = dom(success.html).querySelector("#upcoming-meeting");
        expect(panel).not.toBeNull();

        if (events.length > 0) {
          expect(panel?.querySelector(".upcoming-title")?.textContent).toBe(
            event.title
          );
        } else {
          expect(panel?.textContent).toContain("No upcoming meeting");
        }

        expect(
          dom(active.html).querySelector("#upcoming-meeting")?.outerHTML
        ).toBe(panel?.outerHTML);
        expect(active.html).not.toContain("Updating upcoming meetings");
        const content = events.length === 0 ? "empty" : "meeting";

        for (const [state, html] of [
          ["success", success.html],
          ["refreshing", active.html],
        ]) {
          yield* fs.writeFileString(
            `../../.git/upcoming-${content}-${state}-fixture.html`,
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="1440x900"><title>Upcoming ${content} ${state}</title><style>${css}</style></head><body>${html}<script>const panel=document.querySelector('#upcoming-meeting');if(!panel)throw Error('Missing upcoming panel');document.documentElement.dataset.upcomingPanelHeight=String(panel.getBoundingClientRect().height);document.documentElement.dataset.upcomingRefreshState='${state}';</script></body></html>`
          );
        }
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
