import { EventFields, EventTime, GoogleHttp } from "@calendar/calendar";
import type {
  EventTimeValue,
  GoogleRequestValue,
  GoogleResponse,
} from "@calendar/calendar";
import { DateTime, Effect, Layer, Schema } from "effect";

const FakeEvent = Schema.Struct({
  ...EventFields.fields,
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
  readonly accessRole: string;
  readonly backgroundColor: string;
  readonly colorId: string;
  readonly foregroundColor: string;
  readonly id: string;
  readonly primary: boolean;
  readonly summary: string;
  readonly timeZone: string;
}

type FakeResponseBody =
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

const writeEvent = Effect.fn("fakeCalendarGoogle.writeEvent")(
  function* writeEvent(
    events: Map<string, FakeEventValue>,
    request: GoogleRequestValue,
    eventId: string | undefined
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

    const next: FakeEventValue = {
      status: "confirmed",
      ...previous,
      ...fields,
      id,
    };

    events.set(id, next);

    return reply(200, next);
  }
);

const palette = {
  calendar: {
    "1": { background: "#7986cb", foreground: "#ffffff" },
    "2": { background: "#33b679", foreground: "#ffffff" },
    "3": { background: "#8e69b8", foreground: "#ffffff" },
  },
  event: {
    "1": { background: "#a4bdfc", foreground: "#1d1d1d" },
    "2": { background: "#7ae7bf", foreground: "#1d1d1d" },
    "3": { background: "#dbadff", foreground: "#1d1d1d" },
  },
};

export const fakeCalendarGoogle = Effect.fn("fakeCalendarGoogle")(
  function* fakeCalendarGoogle(
    accounts: readonly { readonly id: string; readonly email: string }[]
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

    const calendars = new Map(
      accounts.map((account, index) => [
        account.id,
        [
          {
            accessRole: "owner",
            backgroundColor: index === 0 ? "#7986cb" : "#33b679",
            colorId: String(index + 1),
            foregroundColor: "#ffffff",
            id: account.email,
            primary: true,
            summary: index === 0 ? "Personal" : "Work",
            timeZone: "UTC",
          },
          {
            accessRole: "owner",
            backgroundColor: "#8e69b8",
            colorId: "3",
            foregroundColor: "#ffffff",
            id: `${account.email}:shared`,
            primary: false,
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
                timed("overlap", "Design review", 0, 9.5, 1.5),
                {
                  end: date(2),
                  id: "allday",
                  start: date(1),
                  status: "confirmed",
                  summary: "School holiday",
                },
                {
                  end: date(5),
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
                  recurrence: ["RRULE:FREQ=DAILY;COUNT=10"],
                },
                ...Array.from({ length: 10 }, (_, day) => ({
                  ...timed(
                    `series${day}`,
                    day === 2 ? "Focus, moved later" : "Daily focus",
                    day,
                    day === 2 ? 17 : 16
                  ),
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

    return Layer.succeed(GoogleHttp, {
      execute: Effect.fn("fakeCalendarGoogle.execute")(function* execute(
        request: GoogleRequestValue
      ) {
        const url = new URL(request.path, "https://fake-calendar.invalid");

        if (url.pathname === "/colors") {
          return reply(200, palette);
        }

        if (url.pathname === "/users/me/calendarList") {
          return reply(200, { items: calendars.get(request.accountId) ?? [] });
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
          const result = yield* writeEvent(events, request, eventId);

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
