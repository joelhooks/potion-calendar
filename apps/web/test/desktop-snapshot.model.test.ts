import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Option, Schema } from "effect";

import {
  initialModel,
  Message,
  RemoteSession,
  update,
} from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { agendaSnapshot } from "../src/client/desktop/snapshot.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { editorDraft, editorViewFields } from "./editor-fixture.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingKeys,
  upcomingNow,
  upcomingPerson,
  upcomingSession,
} from "./upcoming-fixture.js";

const hour = 60 * 60_000;

const preferences = defaultDesktopPreferences();

const eventAt = (eventId: string, hours: number): CalendarEventValue => ({
  ...savedUpcomingEvent,
  end: {
    dateTime: DateTime.formatIso(
      DateTime.makeUnsafe(upcomingNow + (hours + 2) * hour)
    ),
  },
  eventId,
  iCalUID: `${eventId}@calendar-fixture.test`,
  originalStartTime: undefined,
  recurringEventId: undefined,
  start: {
    dateTime: DateTime.formatIso(
      DateTime.makeUnsafe(upcomingNow + hours * hour)
    ),
  },
});

const loaded = (
  events: readonly CalendarEventValue[],
  hidden: readonly string[] = []
) => {
  const model = upcomingFixture(hidden);

  return update(
    model,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: model.upcoming.request,
      result: { events, versions: [] },
    })
  ).model;
};

it.effect.prop(
  "the default publication includes in-progress saved events and only its rolling three-day horizon",
  {
    hours: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 800, minimum: -3 }))
    ),
  },
  ({ hours }) =>
    Effect.sync(() => {
      const snapshot = agendaSnapshot(
        loaded([eventAt("candidate", hours)]),
        preferences
      );

      expect(snapshot.events.length).toBe(hours >= -1 && hours < 72 ? 1 : 0);
    })
);

it.effect(
  "applies selection and N11 exclusions independently of grid visibility",
  () =>
    Effect.sync(() => {
      const model = loaded(
        [
          eventAt("visible", 1),
          { ...eventAt("hidden", 1), calendarId: "team" },
          { ...eventAt("cancelled", 1), status: "cancelled" },
          {
            ...eventAt("declined", 1),
            attendees: [
              {
                email: "self@example.test",
                responseStatus: "declined",
                self: true,
              },
            ],
          },
          {
            ...eventAt("all-day", 1),
            end: { date: "2026-10-22" },
            start: { date: "2026-10-21" },
          },
          { ...eventAt("missing-time", 1), start: undefined },
        ],
        [upcomingKeys[1] ?? ""]
      );

      const snapshot = agendaSnapshot(model, preferences);

      expect(snapshot.events.map((event) => event.key.eventId)).toEqual([
        "visible",
      ]);
      expect(
        agendaSnapshot({ ...model, person: Option.none() }, preferences).events
      ).toEqual([]);
      expect(
        agendaSnapshot(model, { ...preferences, menuBar: false }).events
      ).toEqual([]);
    })
);

it.effect(
  "keeps location-only and conferencing-only meetings when excluding events with neither",
  () =>
    Effect.sync(() => {
      const model = loaded([
        { ...eventAt("physical", 1), location: "Private meeting address" },
        {
          ...eventAt("video", 2),
          conferenceUrl: "https://meet.example.test/room",
        },
        eventAt("neither", 3),
      ]);

      const snapshot = agendaSnapshot(model, {
        ...preferences,
        includeWithoutConferencingOrLocation: false,
      });

      expect(snapshot.events.map((event) => event.key.eventId)).toEqual([
        "physical",
        "video",
      ]);
      expect(snapshot.events[0]?.hasLocation).toBe(true);
      expect(snapshot.events[0]?.conferenceUrl).toBeNull();
      expect(snapshot.events[1]?.hasLocation).toBe(false);
      expect(JSON.stringify(snapshot)).not.toContain("Private meeting address");
    })
);

it.effect("publishes an Always preview beyond a one-day menu", () =>
  Effect.sync(() => {
    const settings = {
      ...preferences,
      includeDays: 1,
      previewMinutes: 10_080,
    } satisfies typeof preferences;

    const snapshot = agendaSnapshot(
      loaded([eventAt("tomorrow", 12), eventAt("five-days", 120)]),
      settings
    );

    expect(snapshot.events.map((event) => event.key.eventId)).toEqual([
      "tomorrow",
      "five-days",
    ]);
    expect(
      snapshot.events.find((event) => event.key.eventId === "five-days")?.start
    ).toBe(upcomingNow + 120 * hour);
  })
);

it.effect(
  "projects saved participants only and does not publish drafts or descriptions",
  () =>
    Effect.sync(() => {
      const initial = loaded([savedUpcomingEvent]);

      const model = {
        ...initial,
        calendar: {
          ...initial.calendar,
          reads: [
            {
              accountId: "work",
              events: RemoteEvents.Success({
                data: { events: [eventAt("range-only", 1)], versions: [] },
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

      const snapshot = agendaSnapshot(model, preferences);

      expect(snapshot.events.map((event) => event.key.eventId)).toEqual([
        savedUpcomingEvent.eventId,
      ]);
      expect(snapshot.events[0]?.hasParticipants).toBe(false);
      expect(
        agendaSnapshot(model, {
          ...preferences,
          includeWithoutParticipants: false,
        }).events
      ).toEqual([]);
      expect(JSON.stringify(snapshot)).not.toContain("draft-only@example.test");
      expect(JSON.stringify(snapshot)).not.toContain(
        savedUpcomingEvent.description
      );
    })
);

it.effect(
  "publishes only permitted saved participant emails, excluding self, resources and duplicate addresses",
  () =>
    Effect.sync(() => {
      const event = {
        ...eventAt("email-recipients", 1),
        attendees: [
          { email: "PERSON@example.test" },
          { email: "other-self@example.test", self: true },
          { email: "room@example.test", resource: true },
          { email: "guest+tag@example.test" },
          { email: "GUEST+TAG@example.test" },
          { email: "second@example.test" },
        ],
      };

      const snapshot = agendaSnapshot(loaded([event]), preferences);
      expect(snapshot.events[0]?.participantEmails).toEqual([
        "guest+tag@example.test",
        "second@example.test",
      ]);
      expect(JSON.stringify(snapshot)).not.toContain("other-self@example.test");
      expect(JSON.stringify(snapshot)).not.toContain("room@example.test");
    })
);

it.effect(
  "email publication requires the matching session and excludes every linked-account email",
  () =>
    Effect.sync(() => {
      const model = loaded([
        {
          ...eventAt("email-session", 1),
          attendees: [
            { email: "alias@example.test" },
            { email: "guest@example.test" },
          ],
        },
      ]);

      const session = {
        ...upcomingSession,
        accounts: [
          ...upcomingSession.accounts,
          { disconnected: false, email: "alias@example.test", id: "personal" },
        ],
      };

      const linked = {
        ...model,
        session: RemoteSession.Success({ data: session }),
      };

      expect(
        agendaSnapshot(linked, preferences).events[0]?.participantEmails
      ).toEqual(["guest@example.test"]);

      const missing = {
        ...linked,
        session: initialModel(upcomingNow, "UTC").session,
      };

      expect(
        agendaSnapshot(missing, preferences).events[0]?.participantEmails
      ).toEqual([]);

      const wrong = {
        ...linked,
        session: RemoteSession.Success({
          data: { ...session, user: { ...session.user, id: "another-person" } },
        }),
      };

      expect(
        agendaSnapshot(wrong, preferences).events[0]?.participantEmails
      ).toEqual([]);
    })
);

it.effect.prop(
  "the desktop email projection preserves the web privacy and event-type rules",
  {
    hidden: Arbitrary.schema(Schema.Boolean),
    omitted: Arbitrary.schema(Schema.Boolean),
    ordinary: Arbitrary.schema(Schema.Boolean),
    ownOrganizer: Arbitrary.schema(Schema.Boolean),
  },
  ({ hidden, omitted, ordinary, ownOrganizer }) =>
    Effect.sync(() => {
      const event: CalendarEventValue = {
        ...eventAt("email-privacy", 1),
        attendees: [{ email: "guest@example.test" }],
        attendeesOmitted: omitted,
        eventType: ordinary ? "default" : "outOfOffice",
        guestsCanSeeOtherGuests: !hidden,
        organizer: { email: "organizer@example.test", self: ownOrganizer },
      };

      expect(
        agendaSnapshot(loaded([event]), preferences).events[0]
          ?.participantEmails
      ).toEqual(
        ordinary && !omitted && (!hidden || ownOrganizer)
          ? ["guest@example.test"]
          : []
      );
    })
);

it.effect(
  "supports all-day opt-in, strips unsafe conferencing, and deduplicates saved ids",
  () =>
    Effect.sync(() => {
      const allDay = {
        ...eventAt("all-day", 1),
        end: { date: "2026-10-22" },
        start: { date: "2026-10-21" },
      };

      const initial = loaded([
        allDay,
        { ...allDay, calendarId: "team" },
        // oxlint-disable-next-line no-script-url -- Saved provider URLs must not become executable desktop join actions.
        { ...eventAt("unsafe-link", 2), conferenceUrl: "javascript:alert(1)" },
      ]);

      const model = {
        ...initial,
        calendar: { ...initial.calendar, zone: "America/Los_Angeles" },
      };

      const snapshot = agendaSnapshot(model, {
        ...preferences,
        includeAllDay: true,
      });

      expect(
        snapshot.events.filter((event) => event.key.eventId === "all-day")
      ).toHaveLength(1);
      expect(
        snapshot.events.find((event) => event.key.eventId === "all-day")?.start
      ).toBe(
        DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-21T07:00:00Z"))
      );
      expect(
        snapshot.events.find((event) => event.key.eventId === "unsafe-link")
          ?.conferenceUrl
      ).toBeNull();
    })
);
