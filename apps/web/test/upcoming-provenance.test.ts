import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Message, update } from "../src/client/app.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import {
  upcomingFixture,
  upcomingNow,
  upcomingPerson,
  upcomingResult,
} from "./upcoming-fixture.js";

const notice = LiveNotice.cases.CalendarChanged.make({
  change: {
    accountId: "work",
    calendarId: "primary",
    reason: "sync",
    version: 2,
  },
});

it.effect(
  "only an accepted live-origin read advances live provenance, never a start, failure or stale result",
  () =>
    Effect.sync(() => {
      const initial = upcomingFixture();
      expect(Option.isNone(initial.upcoming.accepted)).toBe(true);

      const loaded = update(
        initial,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: initial.upcoming.request,
          result: upcomingResult,
        })
      ).model;

      const baseline = Option.some({
        origin: "snapshot",
        request: loaded.upcoming.request,
      });

      expect(loaded.upcoming.accepted).toEqual(baseline);

      const live = update(
        loaded,
        Message.ReceivedLive({ notice, personId: upcomingPerson })
      ).model;

      expect(Option.getOrThrow(live.upcoming.query).origin).toBe("live");
      expect(live.upcoming.accepted).toEqual(baseline);

      const failed = update(
        live,
        Message.FailedUpcoming({
          failure: { kind: "retry", message: "Read failed" },
          personId: upcomingPerson,
          request: live.upcoming.request,
        })
      ).model;

      expect(failed.upcoming.accepted).toEqual(baseline);

      const clock = update(
        failed,
        Message.Ticked({ now: upcomingNow + 300_000 })
      ).model;

      expect(Option.getOrThrow(clock.upcoming.query).origin).toBe("snapshot");

      const stale = update(
        clock,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: live.upcoming.request,
          result: upcomingResult,
        })
      ).model;

      expect(stale.upcoming.accepted).toEqual(baseline);

      const refreshed = update(
        stale,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: clock.upcoming.request,
          result: upcomingResult,
        })
      ).model;

      expect(refreshed.upcoming.accepted).toEqual(
        Option.some({ origin: "snapshot", request: clock.upcoming.request })
      );

      const latest = update(
        refreshed,
        Message.ReceivedLive({ notice, personId: upcomingPerson })
      ).model;

      const accepted = update(
        latest,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: latest.upcoming.request,
          result: upcomingResult,
        })
      ).model;

      expect(accepted.upcoming.accepted).toEqual(
        Option.some({ origin: "live", request: latest.upcoming.request })
      );
    })
);

it.effect(
  "the existing minute clock reaches five-minute boundaries even after a mid-minute live refresh",
  () =>
    Effect.sync(() => {
      const initial = upcomingFixture();

      const midway = {
        ...initial,
        calendar: { ...initial.calendar, now: upcomingNow + 30_000 },
      };

      const refreshed = update(
        midway,
        Message.ReceivedLive({ notice, personId: upcomingPerson })
      ).model;

      expect(refreshed.upcoming.refreshAt).toBe(upcomingNow + 300_000);

      const ticked = update(
        refreshed,
        Message.Ticked({ now: upcomingNow + 300_000 })
      ).model;

      expect(ticked.upcoming.request).toBe(refreshed.upcoming.request + 1);
      expect(Option.getOrThrow(ticked.upcoming.query).origin).toBe("snapshot");
    })
);
