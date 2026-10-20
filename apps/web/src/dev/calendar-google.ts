import { EventFields, EventTime, GoogleHttp } from "@calendar/calendar";
import type {
  ColorsValue,
  EventTimeValue,
  GoogleRequestValue,
  GoogleResponse,
} from "@calendar/calendar";
import { CalendarAppearancePatch } from "@calendar/calendar/contracts";
import { DateTime, Effect, Layer, Schema } from "effect";

export const FakeConferenceOutcome = Schema.Literals([
  "success",
  "pending",
  "failure",
]);

const FakeConferenceData = Schema.Struct({
  conferenceId: Schema.optional(Schema.String),
  conferenceSolution: Schema.optional(
    Schema.Struct({
      iconUri: Schema.optional(Schema.String),
      key: Schema.Struct({ type: Schema.String }),
      name: Schema.optional(Schema.String),
    })
  ),
  createRequest: Schema.optional(
    Schema.Struct({
      conferenceSolutionKey: Schema.Struct({
        type: Schema.Literal("hangoutsMeet"),
      }),
      requestId: Schema.NonEmptyString,
      status: Schema.optional(
        Schema.Struct({ statusCode: FakeConferenceOutcome })
      ),
    })
  ),
  entryPoints: Schema.optional(
    Schema.Array(
      Schema.Struct({
        accessCode: Schema.optional(Schema.String),
        entryPointType: Schema.String,
        label: Schema.optional(Schema.String),
        meetingCode: Schema.optional(Schema.String),
        passcode: Schema.optional(Schema.String),
        password: Schema.optional(Schema.String),
        pin: Schema.optional(Schema.String),
        uri: Schema.String,
      })
    )
  ),
  notes: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
});

const FakeEvent = Schema.Struct({
  ...EventFields.fields,
  conferenceData: Schema.optional(Schema.NullOr(FakeConferenceData)),
  iCalUID: Schema.optional(Schema.String),
  id: Schema.String,
  organizer: Schema.optional(Schema.Struct({ self: Schema.Boolean })),
  originalStartTime: Schema.optional(EventTime),
  recurringEventId: Schema.optional(Schema.String),
  status: Schema.optional(
    Schema.Literals(["confirmed", "tentative", "cancelled"])
  ),
  summary: Schema.optional(Schema.String),
});

const FakeWrite = Schema.Struct({
  ...FakeEvent.fields,
  id: Schema.optional(Schema.String),
});

type FakeEventValue = typeof FakeEvent.Type;

interface FakeCalendarValue {
  readonly conferenceProperties: {
    readonly allowedConferenceSolutionTypes: readonly string[];
  };
  readonly defaultReminders?: readonly {
    readonly method: "email" | "popup";
    readonly minutes: number;
  }[];
  readonly accessRole: string;
  readonly backgroundColor: string;
  readonly colorId: string;
  readonly foregroundColor: string;
  readonly hidden?: boolean;
  readonly selected?: boolean;
  readonly id: string;
  readonly primary: boolean;
  readonly summary: string;
  readonly timeZone: string;
}

const primaryReminders: NonNullable<FakeCalendarValue["defaultReminders"]> = [
  { method: "popup", minutes: 10 },
];

const secondaryReminders: NonNullable<FakeCalendarValue["defaultReminders"]> = [
  { method: "email", minutes: 30 },
];

type FakeResponseBody =
  | FakeCalendarValue
  | FakeEventValue
  | {
      readonly items: readonly (FakeEventValue | FakeCalendarValue)[];
      readonly nextSyncToken?: string;
    }
  | {
      readonly calendar: Readonly<
        Record<
          string,
          { readonly background: string; readonly foreground: string }
        >
      >;
      readonly event: Readonly<
        Record<
          string,
          { readonly background: string; readonly foreground: string }
        >
      >;
    }
  | { readonly error?: { readonly message: string } };

const reply = (status: number, value: FakeResponseBody): GoogleResponse => ({
  body: JSON.stringify(value),
  retryAfterMs: 0,
  status,
});

const keyFor = (accountId: string, calendarId: string) =>
  JSON.stringify([accountId, calendarId]);

const instantFor = (time: EventTimeValue | undefined) => {
  if (time === undefined) {
    return time;
  }

  return DateTime.toEpochMillis(
    DateTime.makeUnsafe(
      "date" in time ? `${time.date}T00:00:00Z` : time.dateTime
    )
  );
};

const visibleEvents = (
  events: Map<string, FakeEventValue>,
  url: URL,
  eventId: string | undefined
) => {
  const instances = url.pathname.endsWith("/instances");
  const singleEvents = url.searchParams.get("singleEvents") === "true";
  const minimum = url.searchParams.get("timeMin");
  const maximum = url.searchParams.get("timeMax");

  const low =
    minimum === null
      ? undefined
      : DateTime.toEpochMillis(DateTime.makeUnsafe(minimum));

  const high =
    maximum === null
      ? undefined
      : DateTime.toEpochMillis(DateTime.makeUnsafe(maximum));

  return [...events.values()].filter((event) => {
    if (instances && event.recurringEventId !== eventId) {
      return false;
    }

    if (singleEvents && event.recurrence !== undefined) {
      return false;
    }

    const start = instantFor(event.start);
    const end = instantFor(event.end);

    return (
      (low === undefined || end === undefined || end > low) &&
      (high === undefined || start === undefined || start < high)
    );
  });
};

const conferenceForWrite = (
  previous: FakeEventValue["conferenceData"],
  requested: FakeEventValue["conferenceData"],
  url: URL,
  outcome: typeof FakeConferenceOutcome.Type
): FakeEventValue["conferenceData"] => {
  if (
    url.searchParams.get("conferenceDataVersion") !== "1" ||
    requested === undefined
  ) {
    return previous;
  }

  if (requested === null) {
    return null;
  }

  const { createRequest } = requested;

  if (createRequest === undefined) {
    return requested;
  }

  if (createRequest.requestId === previous?.createRequest?.requestId) {
    return previous;
  }

  return {
    conferenceId:
      outcome === "success" ? `dev-${createRequest.requestId}` : undefined,
    conferenceSolution:
      outcome === "success"
        ? { key: { type: "hangoutsMeet" }, name: "Google Meet" }
        : undefined,
    createRequest: { ...createRequest, status: { statusCode: outcome } },
    entryPoints:
      outcome === "success"
        ? [
            {
              entryPointType: "video",
              uri: `https://meet.google.com/dev-${createRequest.requestId}`,
            },
          ]
        : undefined,
    signature:
      outcome === "success" ? `fixture-${createRequest.requestId}` : undefined,
  };
};

const writeEvent = Effect.fn("fakeCalendarGoogle.writeEvent")(
  function* writeEvent(
    events: Map<string, FakeEventValue>,
    request: GoogleRequestValue,
    eventId: string | undefined,
    url: URL,
    conferenceOutcome: typeof FakeConferenceOutcome.Type
  ) {
    if (request.method === "DELETE") {
      const previous = eventId === undefined ? undefined : events.get(eventId);

      if (previous === undefined) {
        return reply(404, {});
      }

      events.set(previous.id, { ...previous, status: "cancelled" });

      return reply(204, {});
    }

    const fields = yield* Schema.decodeEffect(Schema.fromJsonString(FakeWrite))(
      request.body ?? "{}"
    ).pipe(Effect.orDie);

    const id = eventId ?? fields.id;

    if (id === undefined) {
      return reply(400, {});
    }

    const previous = events.get(id);

    if (request.method === "POST" && previous !== undefined) {
      return reply(409, {});
    }

    if (request.method === "PATCH" && previous === undefined) {
      return reply(404, {});
    }

    const { conferenceData: requested, ...ordinaryFields } = fields;

    const conferenceData = conferenceForWrite(
      previous?.conferenceData,
      requested,
      url,
      conferenceOutcome
    );

    const next: FakeEventValue = {
      iCalUID: `${request.accountId}:${id}@calendar-fixture.test`,
      organizer: { self: true },
      status: "confirmed",
      ...previous,
      ...ordinaryFields,
      conferenceData,
      id,
    };

    events.set(id, next);

    return reply(200, next);
  }
);

const palette: ColorsValue = {
  calendar: {
    "1": { background: "#7986cb", foreground: "#ffffff" },
    "2": { background: "#33b679", foreground: "#ffffff" },
    "3": { background: "#8e69b8", foreground: "#ffffff" },
  },
  event: {
    "1": { background: "#a4bdfc", foreground: "#1d1d1d" },
    "2": { background: "#7ae7bf", foreground: "#1d1d1d" },
    "3": { background: "#dbadff", foreground: "#1d1d1d" },
    "9": { background: "#556677", foreground: "#ffffff" },
  },
};

export const fakeCalendarGoogle = Effect.fn("fakeCalendarGoogle")(
  function* fakeCalendarGoogle(
    accounts: readonly { readonly id: string; readonly email: string }[],
    conferenceOutcome: typeof FakeConferenceOutcome.Type = "success"
  ) {
    const now = yield* DateTime.now;
    const monday = DateTime.startOf(now, "week", { weekStartsOn: 1 });

    const instant = (days: number, hours: number) => ({
      dateTime: DateTime.formatIso(
        DateTime.add(monday, { days, minutes: Math.round(hours * 60) })
      ),
      timeZone: "UTC",
    });

    const date = (days: number) => ({
      date: DateTime.formatIsoDateUtc(DateTime.add(monday, { days })),
    });

    const calendars = new Map<string, FakeCalendarValue[]>(
      accounts.map((account, index) => [
        account.id,
        [
          {
            accessRole: "owner",
            backgroundColor: index === 0 ? "#7986cb" : "#33b679",
            colorId: String(index + 1),
            conferenceProperties: {
              allowedConferenceSolutionTypes: ["hangoutsMeet"],
            },
            defaultReminders: primaryReminders,
            foregroundColor: "#ffffff",
            id: account.email,
            primary: true,
            selected: true,
            summary: index === 0 ? "Personal" : "Work",
            timeZone: "UTC",
          },
          {
            accessRole: "owner",
            backgroundColor: "#8e69b8",
            colorId: "3",
            conferenceProperties: { allowedConferenceSolutionTypes: [] },
            defaultReminders: secondaryReminders,
            foregroundColor: "#ffffff",
            id: `${account.email}:shared`,
            primary: false,
            selected: true,
            summary: index === 0 ? "Family" : "Projects",
            timeZone: "UTC",
          },
        ],
      ])
    );

    const eventSets = new Map<string, Map<string, FakeEventValue>>();

    for (const [accountIndex, account] of accounts.entries()) {
      for (const [calendarIndex, calendar] of (
        calendars.get(account.id) ?? []
      ).entries()) {
        const timed = (
          id: string,
          summary: string,
          day: number,
          hour: number,
          duration = 1
        ): FakeEventValue => ({
          end: instant(day, hour + duration),
          iCalUID: `${calendar.id}:${id}@calendar-fixture.test`,
          id,
          organizer: { self: true },
          start: instant(day, hour),
          status: "confirmed",
          summary,
        });

        const events: FakeEventValue[] =
          calendarIndex === 0
            ? [
                timed(
                  "morning",
                  accountIndex === 0 ? "Coffee and planning" : "Team planning",
                  0,
                  9
                ),
                {
                  ...timed("overlap", "Design review", 0, 9.5, 1.5),
                  iCalUID: "design-review-invitation@calendar-fixture.test",
                  organizer: { self: accountIndex === 0 },
                },
                ...(accountIndex === 0
                  ? [
                      timed("accountonly", "Read a chapter", 1, 8),
                      timed("reviewlookalike", "Design review", 0, 9.5, 1.5),
                    ]
                  : []),
                {
                  end: date(2),
                  iCalUID: `${calendar.id}:allday@calendar-fixture.test`,
                  id: "allday",
                  start: date(1),
                  status: "confirmed",
                  summary: "School holiday",
                },
                {
                  end: date(5),
                  iCalUID: `${calendar.id}:multiday@calendar-fixture.test`,
                  id: "multiday",
                  start: date(3),
                  status: "confirmed",
                  summary: "Two-day workshop",
                },
                {
                  ...timed("declined", "Optional vendor call", 2, 10),
                  attendees: [
                    {
                      email: account.email,
                      responseStatus: "declined",
                      self: true,
                    },
                  ],
                },
                {
                  ...timed("tentative", "Project catch-up", 3, 14),
                  attendees: [
                    {
                      email: account.email,
                      responseStatus: "tentative",
                      self: true,
                    },
                  ],
                  status: "tentative",
                },
                {
                  ...timed("unanswered", "Lunch invitation", 4, 12),
                  attendees: [
                    {
                      email: account.email,
                      responseStatus: "needsAction",
                      self: true,
                    },
                  ],
                },
                timed("overnight", "Late release window", 4, 23, 2),
                {
                  ...timed("series", "Daily focus", 0, 16),
                  iCalUID: "daily-focus-series@calendar-fixture.test",
                  organizer: { self: accountIndex === 0 },
                  recurrence: ["RRULE:FREQ=DAILY;COUNT=10"],
                },
                ...Array.from({ length: 10 }, (_, day) => ({
                  ...timed(
                    `series${day}`,
                    day === 2 ? "Focus, moved later" : "Daily focus",
                    day,
                    day === 2 ? 17 : 16
                  ),
                  iCalUID: "daily-focus-series@calendar-fixture.test",
                  organizer: { self: accountIndex === 0 },
                  originalStartTime: instant(day, 16),
                  recurringEventId: "series",
                  status:
                    day === 5 ? ("cancelled" as const) : ("confirmed" as const),
                })),
                timed("nextweek", "Next week's planning", 7, 9),
                timed("retrospective", "Two-week retrospective", 11, 15),
              ]
            : [
                timed(
                  "shared",
                  accountIndex === 0 ? "Family dinner" : "Project milestone",
                  2,
                  18,
                  2
                ),
                timed("nextshared", "Shared planning", 9, 18),
              ];

        eventSets.set(
          keyFor(account.id, calendar.id),
          new Map(events.map((event) => [event.id, event]))
        );
      }
    }

    const revisions = new Map<string, number>();

    const readCalendars = (accountId: string, url: URL) => {
      const listed = calendars.get(accountId) ?? [];

      if (url.pathname === "/users/me/calendarList") {
        return reply(200, {
          items:
            url.searchParams.get("showHidden") === "true"
              ? listed
              : listed.filter((calendar) => calendar.hidden !== true),
        });
      }

      const id = decodeURIComponent(
        url.pathname.slice("/users/me/calendarList/".length)
      );

      const calendar = listed.find((candidate) => candidate.id === id);

      return calendar === undefined ? reply(404, {}) : reply(200, calendar);
    };

    const writeCalendar = Effect.fn("fakeCalendarGoogle.writeCalendar")(
      function* writeCalendar(request: GoogleRequestValue, url: URL) {
        const listed = calendars.get(request.accountId) ?? [];

        const id = decodeURIComponent(
          url.pathname.slice("/users/me/calendarList/".length)
        );

        const previous = listed.find((calendar) => calendar.id === id);

        if (previous === undefined) {
          return reply(404, {});
        }

        const patch = yield* Schema.decodeEffect(
          Schema.fromJsonString(CalendarAppearancePatch)
        )(request.body ?? "{}").pipe(Effect.orDie);

        const color =
          patch.colorId === undefined
            ? undefined
            : palette.calendar[patch.colorId];

        if (patch.colorId !== undefined && color === undefined) {
          return reply(400, {});
        }

        const updated = {
          ...previous,
          ...patch,
          backgroundColor: color?.background ?? previous.backgroundColor,
          foregroundColor: color?.foreground ?? previous.foregroundColor,
        };

        calendars.set(
          request.accountId,
          listed.map((calendar) => (calendar.id === id ? updated : calendar))
        );

        return reply(200, updated);
      }
    );

    const move = (accountId: string, url: URL) => {
      const segments = url.pathname.split("/");

      const sourceKey = keyFor(
        accountId,
        decodeURIComponent(segments[2] ?? "")
      );

      const targetKey = keyFor(
        accountId,
        url.searchParams.get("destination") ?? ""
      );

      const source = eventSets.get(sourceKey);
      const target = eventSets.get(targetKey);
      const event = source?.get(decodeURIComponent(segments[4] ?? ""));

      if (source === undefined || target === undefined || event === undefined) {
        return reply(404, {});
      }

      source.delete(event.id);
      target.set(event.id, event);
      revisions.set(sourceKey, (revisions.get(sourceKey) ?? 0) + 1);
      revisions.set(targetKey, (revisions.get(targetKey) ?? 0) + 1);

      return reply(200, event);
    };

    return Layer.succeed(GoogleHttp, {
      execute: Effect.fn("fakeCalendarGoogle.execute")(function* execute(
        request: GoogleRequestValue
      ) {
        const url = new URL(request.path, "https://fake-calendar.invalid");

        if (url.pathname === "/colors") {
          return reply(200, palette);
        }

        if (url.pathname.startsWith("/users/me/calendarList")) {
          if (request.method === "PATCH") {
            return yield* writeCalendar(request, url);
          }

          return request.method === "GET"
            ? readCalendars(request.accountId, url)
            : reply(405, {});
        }

        if (request.method === "POST" && url.pathname.endsWith("/move")) {
          return move(request.accountId, url);
        }

        const [, prefix, encodedCalendar, resource, encodedEvent, instances] =
          url.pathname.split("/");

        const calendarId = decodeURIComponent(encodedCalendar ?? "");
        const key = keyFor(request.accountId, calendarId);
        const events = eventSets.get(key);

        if (
          prefix !== "calendars" ||
          resource !== "events" ||
          events === undefined
        ) {
          return reply(404, { error: { message: "Calendar not found" } });
        }

        const eventId =
          encodedEvent === undefined
            ? undefined
            : decodeURIComponent(encodedEvent);

        if (request.method !== "GET") {
          const result = yield* writeEvent(
            events,
            request,
            eventId,
            url,
            conferenceOutcome
          );

          if (result.status < 300) {
            revisions.set(key, (revisions.get(key) ?? 0) + 1);
          }

          return result;
        }

        if (eventId !== undefined && instances !== "instances") {
          const event = events.get(eventId);

          return event === undefined ? reply(404, {}) : reply(200, event);
        }

        const cursor = `fake-sync-${revisions.get(key) ?? 0}`;

        const items =
          url.searchParams.get("syncToken") === cursor
            ? []
            : visibleEvents(events, url, eventId);

        return reply(200, { items, nextSyncToken: cursor });
      }),
    });
  }
);
