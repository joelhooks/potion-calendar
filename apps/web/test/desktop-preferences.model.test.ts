import type { CalendarEventValue } from "@calendar/calendar/contracts";
import {
  defaultDesktopPreferences,
  DesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Match, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { agendaSnapshot } from "../src/client/desktop/snapshot.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingNow,
  upcomingPerson,
} from "./upcoming-fixture.js";

const minute = 60_000;

const eventAt = (id: string, minutes = 20): CalendarEventValue => ({
  ...savedUpcomingEvent,
  attendees: [{ email: "guest@example.test", responseStatus: "accepted" }],
  conferenceUrl: "https://meet.google.com/abc-defg-hij",
  end: {
    dateTime: DateTime.formatIso(
      DateTime.makeUnsafe(upcomingNow + (minutes + 30) * minute)
    ),
  },
  eventId: id,
  iCalUID: `${id}@fixture.test`,
  originalStartTime: undefined,
  recurringEventId: undefined,
  start: {
    dateTime: DateTime.formatIso(
      DateTime.makeUnsafe(upcomingNow + minutes * minute)
    ),
  },
  title: id,
});

const loaded = (events: readonly CalendarEventValue[]) => {
  const base = upcomingFixture();

  return update(
    base,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: base.upcoming.request,
      result: { events, versions: [] },
    })
  ).model;
};

type Filter =
  | "menuBar"
  | "includeAllDay"
  | "includeWithoutParticipants"
  | "includeWithoutConferencingOrLocation";

const filters: readonly Filter[] = [
  "menuBar",
  "includeAllDay",
  "includeWithoutParticipants",
  "includeWithoutConferencingOrLocation",
];

for (const field of filters) {
  it.effect.prop(
    `${field} histories include and exclude exactly the labelled saved event`,
    { history: Arbitrary.schema(Schema.Array(Schema.Boolean)) },
    ({ history }) =>
      Effect.sync(() => {
        const baseline = eventAt("preference-event");

        const event = Match.value(field).pipe(
          Match.when("includeAllDay", () => ({
            ...baseline,
            end: { date: "2026-10-21" },
            start: { date: "2026-10-20" },
          })),
          Match.when("includeWithoutParticipants", () => ({
            ...baseline,
            attendees: [],
          })),
          Match.when("includeWithoutConferencingOrLocation", () => ({
            ...baseline,
            conferenceUrl: undefined,
            description: "",
            location: "",
          })),
          Match.orElse(() => baseline)
        );

        const model = loaded([event]);

        for (const enabled of [true, false, ...history]) {
          const snapshot = agendaSnapshot(model, {
            ...defaultDesktopPreferences(),
            [field]: enabled,
          });

          expect(snapshot.events.map((item) => item.key.eventId)).toEqual(
            enabled ? [event.eventId] : []
          );
        }
      })
  );
}

it.effect.prop(
  "include-days histories publish exactly the selected rolling days",
  {
    history: Arbitrary.schema(
      Schema.Array(DesktopPreferences.fields.includeDays)
    ),
  },
  ({ history }) =>
    Effect.sync(() => {
      const events = Array.from({ length: 30 }, (_, day) =>
        eventAt(`day-${day}`, day * 24 * 60 + 20)
      );

      const model = loaded(events);

      const defaults = defaultDesktopPreferences();
      const initialDays: readonly (typeof defaults.includeDays)[] = [1, 30];

      for (const includeDays of [...initialDays, ...history]) {
        const preferences = { ...defaults, includeDays };

        expect(
          agendaSnapshot(model, preferences).events.map(
            (event) => event.key.eventId
          )
        ).toEqual(events.slice(0, includeDays).map((event) => event.eventId));
      }
    })
);

it.effect(
  "default settings publish a saved no-guest event, keep colliding provider ids distinct and merge equivalent copies by preferred account",
  () =>
    Effect.sync(() => {
      const original = { ...eventAt("collision"), attendees: [] };

      const distinct = {
        ...eventAt("collision"),
        accountId: "personal",
        calendarId: "personal",
        iCalUID: "other@fixture.test",
      };

      const copy = {
        ...eventAt("copied-id"),
        accountId: "personal",
        calendarId: "personal",
        iCalUID: original.iCalUID,
      };

      const snapshot = agendaSnapshot(
        loaded([distinct, copy, original, original]),
        defaultDesktopPreferences()
      );

      expect(snapshot.events).toHaveLength(2);
      expect(
        snapshot.events.find((event) => event.key.accountId === "work")
      ).toMatchObject({
        hasParticipants: false,
        key: { calendarId: original.calendarId, eventId: original.eventId },
      });
      expect(
        snapshot.events.find((event) => event.key.accountId === "personal")
      ).toMatchObject({
        key: { calendarId: distinct.calendarId, eventId: distinct.eventId },
      });

      const acceptedCopy = agendaSnapshot(
        loaded([
          {
            ...original,
            attendees: [
              {
                email: "self@example.test",
                responseStatus: "declined",
                self: true,
              },
            ],
          },
          copy,
        ]),
        defaultDesktopPreferences()
      );

      expect(acceptedCopy.events).toHaveLength(1);
      expect(acceptedCopy.events[0]?.key.accountId).toBe("personal");
    })
);
