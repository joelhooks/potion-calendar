import { expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import { editorDraft, editorViewFields } from "./editor-fixture.js";
import {
  upcomingFixture,
  upcomingKeys,
  upcomingNow,
  upcomingPerson,
  upcomingResult,
  upcomingSession,
  upcomingCalendars,
  savedUpcomingEvent,
} from "./upcoming-fixture.js";

const notice = (calendarId: string) =>
  LiveNotice.cases.CalendarChanged.make({
    change: { accountId: "work", calendarId, reason: "sync", version: 1 },
  });

it.effect.prop(
  "upcoming reads selected calendars for thirty days regardless of the viewed period",
  {
    hidden: Arbitrary.schema(
      Schema.Tuple([Schema.Boolean, Schema.Boolean, Schema.Boolean])
    ),
    offset: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: -100 }))
    ),
  },
  ({ hidden, offset }) =>
    Effect.sync(() => {
      const selected = upcomingKeys.filter(
        (_, index) => hidden[index] !== true
      );

      const model = upcomingFixture(
        upcomingKeys.filter((_, index) => hidden[index] === true)
      );

      const navigated = update(
        model,
        Message.KeyboardDate({ day: model.calendar.navigation.anchor + offset })
      ).model;

      expect(navigated.upcoming).toBe(model.upcoming);

      if (selected.length === 0) {
        expect(Option.isNone(model.upcoming.query)).toBe(true);
        expect(AsyncData.getData(model.upcoming.data)).toEqual(
          Option.some({ events: [], versions: [] })
        );

        return;
      }

      const query = Option.getOrThrow(model.upcoming.query);
      expect(
        query.calendars
          .map((ref) => JSON.stringify([ref.accountId, ref.calendarId]))
          .toSorted()
      ).toEqual(selected.toSorted());
      expect(
        DateTime.toEpochMillis(DateTime.makeUnsafe(query.range.start))
      ).toBe(upcomingNow);
      expect(
        DateTime.toEpochMillis(DateTime.makeUnsafe(query.range.end)) -
          upcomingNow
      ).toBe(30 * 24 * 60 * 60 * 1000);
    })
);

it.effect.prop(
  "the five-minute refresh rolls the range forward without replaying missed intervals",
  {
    elapsed: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 86_400_000, minimum: 0 }))
    ),
  },
  ({ elapsed }) =>
    Effect.sync(() => {
      const model = upcomingFixture();

      const next = update(
        model,
        Message.Ticked({ now: upcomingNow + elapsed })
      ).model;

      expect(next.upcoming.request).toBe(
        model.upcoming.request + (elapsed >= 300_000 ? 1 : 0)
      );
      const query = Option.getOrThrow(next.upcoming.query);
      expect(
        DateTime.toEpochMillis(DateTime.makeUnsafe(query.range.start))
      ).toBe(upcomingNow + (elapsed >= 300_000 ? elapsed : 0));
    })
);

it.effect(
  "refreshes exactly at five minutes and after a backward clock change",
  () =>
    Effect.sync(() => {
      const model = upcomingFixture();

      const before = update(
        model,
        Message.Ticked({ now: upcomingNow + 299_999 })
      ).model;

      expect(before.upcoming).toBe(model.upcoming);

      const at = update(
        before,
        Message.Ticked({ now: upcomingNow + 300_000 })
      ).model;

      expect(at.upcoming.request).toBe(model.upcoming.request + 1);

      const backwards = update(
        at,
        Message.Ticked({ now: upcomingNow - 60_000 })
      ).model;

      expect(
        DateTime.toEpochMillis(
          DateTime.makeUnsafe(
            Option.getOrThrow(backwards.upcoming.query).range.start
          )
        )
      ).toBe(upcomingNow - 60_000);
    })
);

it.effect.prop(
  "old generations and other people cannot replace a newer upcoming read",
  {
    failure: Arbitrary.schema(Schema.Boolean),
    wrongPerson: Arbitrary.schema(Schema.Boolean),
  },
  ({ wrongPerson, failure }) =>
    Effect.sync(() => {
      const first = upcomingFixture();

      const next = update(
        first,
        Message.ClickedCalendar({ accountId: "work", calendarId: "primary" })
      ).model;

      const response = {
        personId: wrongPerson ? "another-person" : upcomingPerson,
        request: wrongPerson ? next.upcoming.request : first.upcoming.request,
      };

      const message = failure
        ? Message.FailedUpcoming({
            ...response,
            failure: { kind: "retry", message: "Read failed" },
          })
        : Message.ReceivedUpcoming({ ...response, result: upcomingResult });

      expect(update(next, message).model).toBe(next);
    })
);

it.effect(
  "session churn never reuses a generation, even for the same person",
  () =>
    Effect.sync(() => {
      const first = upcomingFixture();
      const signedOut = update(first, Message.ClickedSignOut()).model;
      expect(Option.isNone(signedOut.upcoming.query)).toBe(true);
      expect(Option.isNone(AsyncData.getData(signedOut.upcoming.data))).toBe(
        true
      );

      const ended = update(
        signedOut,
        Message.ReceivedSession({ snapshot: null })
      ).model;

      const signedIn = update(
        ended,
        Message.ReceivedSession({ snapshot: upcomingSession })
      ).model;

      const ready = update(
        signedIn,
        Message.ReceivedCalendars({ result: upcomingCalendars })
      ).model;

      expect(ready.upcoming.request).toBeGreaterThan(first.upcoming.request);
      expect(
        update(
          ready,
          Message.ReceivedUpcoming({
            personId: upcomingPerson,
            request: first.upcoming.request,
            result: upcomingResult,
          })
        ).model
      ).toBe(ready);
    })
);

it.effect(
  "live changes refresh only the current person's selected calendars",
  () =>
    Effect.sync(() => {
      const model = upcomingFixture([JSON.stringify(["work", "team"])]);

      expect(
        update(
          model,
          Message.ReceivedLive({
            notice: notice("primary"),
            personId: "another-person",
          })
        ).model.upcoming
      ).toBe(model.upcoming);
      expect(
        update(
          model,
          Message.ReceivedLive({
            notice: notice("team"),
            personId: upcomingPerson,
          })
        ).model.upcoming
      ).toBe(model.upcoming);

      const refreshed = update(
        model,
        Message.ReceivedLive({
          notice: notice("primary"),
          personId: upcomingPerson,
        })
      ).model;

      expect(refreshed.upcoming.request).toBe(model.upcoming.request + 1);
      expect(
        update(
          model,
          Message.ReceivedLive({
            notice: LiveNotice.cases.Reconnected.make({}),
            personId: upcomingPerson,
          })
        ).model.upcoming.request
      ).toBe(model.upcoming.request + 1);
    })
);

it.effect(
  "upcoming stores saved RPC rows, not range data or participant edits",
  () =>
    Effect.sync(() => {
      const initial = upcomingFixture();

      const model = {
        ...initial,
        calendar: {
          ...initial.calendar,
          reads: [
            {
              accountId: "work",
              events: RemoteEvents.Success({
                data: {
                  events: [{ ...savedUpcomingEvent, eventId: "range-only" }],
                  versions: [],
                },
              }),
            },
          ],
        },
        editing: {
          ...initial.editing,
          view: EditorView.cases.Editing.make({
            ...editorViewFields,
            draft: {
              ...editorDraft,
              attendees: [{ email: "draft-only@example.test" }],
            },
          }),
        },
      };

      const received = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: initial.upcoming.request,
          result: upcomingResult,
        })
      ).model;

      expect(AsyncData.getData(received.upcoming.data)).toEqual(
        Option.some(upcomingResult)
      );
      expect(
        Option.getOrThrow(AsyncData.getData(received.upcoming.data)).events[0]
          ?.attendees
      ).toEqual([]);
    })
);

it.effect(
  "same-selection refresh failures retain explicitly stale saved rows; selection changes clear them",
  () =>
    Effect.sync(() => {
      const initial = upcomingFixture();

      const loaded = update(
        initial,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: initial.upcoming.request,
          result: upcomingResult,
        })
      ).model;

      const refreshing = update(
        loaded,
        Message.Ticked({ now: upcomingNow + 300_000 })
      ).model;

      expect(AsyncData.isRefreshing(refreshing.upcoming.data)).toBe(true);

      const failed = update(
        refreshing,
        Message.FailedUpcoming({
          failure: { kind: "retry", message: "Read failed" },
          personId: upcomingPerson,
          request: refreshing.upcoming.request,
        })
      ).model;

      expect(AsyncData.isStale(failed.upcoming.data)).toBe(true);
      expect(AsyncData.getData(failed.upcoming.data)).toEqual(
        Option.some(upcomingResult)
      );

      const changed = update(
        failed,
        Message.ClickedCalendar({ accountId: "work", calendarId: "primary" })
      ).model;

      expect(Option.isNone(AsyncData.getData(changed.upcoming.data))).toBe(
        true
      );
    })
);
