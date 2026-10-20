import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Match, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { RemoteCalendars } from "../src/client/calendar-state.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import { upcomingRefreshMilliseconds } from "../src/client/upcoming/model.js";
import {
  upcomingCalendars,
  upcomingFixture,
  upcomingPerson,
  upcomingResult,
} from "./upcoming-fixture.js";

const paused = (): AppModel => {
  const base = upcomingFixture();

  const { model } = update(
    base,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: base.upcoming.request,
      result: upcomingResult,
    })
  );

  return {
    ...model,
    calendar: { ...model.calendar, index: RemoteCalendars.Loading() },
  };
};

const live = () =>
  Message.ReceivedLive({
    notice: LiveNotice.cases.CalendarChanged.make({
      change: {
        accountId: "work",
        calendarId: "primary",
        reason: "write",
        version: 2,
      },
    }),
    personId: upcomingPerson,
  });

const Trigger = Schema.Literals(["live", "tick", "refresh"]);

const first: readonly (typeof Trigger.Type)[] = ["live", "tick", "refresh"];

it.effect.prop(
  "unavailable-inventory trigger histories coalesce, retain live provenance through an old receipt and drain once",
  { history: Arbitrary.schema(Schema.Array(Trigger)) },
  ({ history }) =>
    Effect.sync(() => {
      let model = paused();
      const { request } = model.upcoming;

      for (const kind of [...first, ...history]) {
        const now = model.calendar.now + upcomingRefreshMilliseconds;

        const message = Match.value(kind).pipe(
          Match.when("live", live),
          Match.when("tick", () => Message.Ticked({ now })),
          Match.orElse(() => Message.ClickedRefresh())
        );

        ({ model } = update(model, message));
        expect(model.upcoming.request).toBe(request);
        expect(model.upcoming.deferredRefresh).toEqual(Option.some("live"));
      }

      ({ model } = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request,
          result: upcomingResult,
        })
      ));
      expect(model.upcoming.deferredRefresh).toEqual(Option.some("live"));
      ({ model } = update(
        model,
        Message.ReceivedCalendars({
          personId: upcomingPerson,
          result: upcomingCalendars,
        })
      ));
      expect(model.upcoming.request).toBe(request + 1);
      expect(Option.getOrThrow(model.upcoming.query).origin).toBe("live");
      expect(Option.isNone(model.upcoming.deferredRefresh)).toBe(true);

      const repeated = update(
        model,
        Message.ReceivedCalendars({
          personId: upcomingPerson,
          result: upcomingCalendars,
        })
      ).model;

      expect(repeated.upcoming.request).toBe(model.upcoming.request);
    })
);

it.effect(
  "session reset discards deferred work and rejects the old inventory response",
  () =>
    Effect.sync(() => {
      const waiting = update(paused(), live()).model;
      expect(Option.isSome(waiting.upcoming.deferredRefresh)).toBe(true);

      const reset = update(
        waiting,
        Message.ReceivedSession({ snapshot: null })
      ).model;

      expect(Option.isNone(reset.upcoming.deferredRefresh)).toBe(true);

      const stale = update(
        reset,
        Message.ReceivedCalendars({
          personId: upcomingPerson,
          result: upcomingCalendars,
        })
      ).model;

      expect(stale).toBe(reset);
      expect(Option.isNone(stale.upcoming.query)).toBe(true);
    })
);

it.effect(
  "a deferred selection change clears old rows and live provenance before reading only the new selection",
  () =>
    Effect.sync(() => {
      const waiting = update(paused(), live()).model;

      const changed = update(
        waiting,
        Message.ClickedCalendar({ accountId: "work", calendarId: "primary" })
      ).model;

      expect(changed.upcoming.deferredRefresh).toEqual(Option.some("snapshot"));
      expect(Option.isNone(changed.upcoming.query)).toBe(true);

      const ready = update(
        changed,
        Message.ReceivedCalendars({
          personId: upcomingPerson,
          result: upcomingCalendars,
        })
      ).model;

      const query = Option.getOrThrow(ready.upcoming.query);
      expect(query.origin).toBe("snapshot");
      expect(
        query.calendars.some(
          (ref) => ref.accountId === "work" && ref.calendarId === "primary"
        )
      ).toBe(false);
    })
);
