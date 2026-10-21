import { Option } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../src/client/app.js";
import { Message, RemoteSession, update } from "../src/client/app.js";
import { RemoteCalendars, RemoteEvents } from "../src/client/calendar-state.js";
import { fixtureModel } from "./fixture.js";
import { meetingEpoch, savedMeeting } from "./meetings-fixture.js";

export const emptyStateScenarios = [
  "upcoming-empty",
  "no-conference",
  "empty-week",
  "refresh-failed",
  "load-failed",
] as const;

export type EmptyStateScenario = (typeof emptyStateScenarios)[number];

export const retryFailure = {
  kind: "retry",
  message: "Google Calendar could not be loaded. Try again.",
} as const;

export const emptyStateFixture = (scenario: EmptyStateScenario): AppModel => {
  const base = fixtureModel();

  const calendars = base.calendar.calendars.filter(
    (calendar) =>
      calendar.accountId === "work" && calendar.calendarId === "primary"
  );

  const events = base.calendar.reads.flatMap((read) =>
    read.accountId === "work"
      ? Option.getOrThrow(AsyncData.getData(read.events)).events.filter(
          (event) => event.calendarId === "primary"
        )
      : []
  );

  const meetings =
    scenario === "no-conference"
      ? [
          savedMeeting(0, 35, 65, {
            conferenceUrl: undefined,
            title: "Team planning",
          }),
        ]
      : [];

  const result = {
    events: scenario === "empty-week" ? [] : [...events, ...meetings],
    versions: calendars.map(({ accountId, calendarId }) => ({
      accountId,
      calendarId,
      version: 1,
    })),
  };

  const model: AppModel = {
    ...base,
    calendar: {
      ...base.calendar,
      calendars,
      hidden: [],
      index: RemoteCalendars.Success({
        data: {
          accounts: [
            {
              accountId: "work",
              calendars,
              colors: { calendar: {}, event: {} },
            },
          ],
        },
      }),
      now: meetingEpoch,
      reads: [
        {
          accountId: "work",
          events:
            scenario === "load-failed"
              ? RemoteEvents.Loading()
              : RemoteEvents.Success({ data: result }),
        },
      ],
      viewportWidth: 700,
    },
    session: RemoteSession.Success({
      data: {
        accounts: [
          { disconnected: false, email: "owner@example.test", id: "work" },
        ],
        user: {
          email: "owner@example.test",
          id: "fixture-person",
          name: "Calendar owner",
        },
      },
    }),
    upcoming: {
      ...base.upcoming,
      data: RemoteEvents.Success({
        data: {
          events: meetings,
          versions: [],
        },
      }),
    },
  };

  return scenario === "refresh-failed" || scenario === "load-failed"
    ? update(
        model,
        Message.FailedEvents({
          accountId: "work",
          failure: retryFailure,
          request: model.calendar.rangeRequest,
        })
      ).model
    : model;
};
