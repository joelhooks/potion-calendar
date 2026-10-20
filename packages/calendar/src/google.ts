import { Context, Effect, Layer, Schema } from "effect";

import { Provider } from "./errors.js";
import type { CalendarFailureValue } from "./errors.js";
import type { GoogleTokens } from "./google-tokens.js";
import {
  Calendar,
  CalendarEvent,
  Colors,
  EventFields,
  EventTime,
  WatchChannel,
} from "./model.js";
import type {
  CalendarValue,
  CalendarEventValue,
  CalendarRefValue,
  ColorsValue,
  EventFieldsValue,
  EventRefValue,
} from "./model.js";
import { googleRequest } from "./transport.js";
import type { GoogleRequestValue, GoogleHttp } from "./transport.js";

const GoogleEvent = Schema.Struct({
  ...EventFields.fields,
  etag: Schema.optional(Schema.String),
  hangoutLink: Schema.optional(Schema.String),
  htmlLink: Schema.optional(Schema.String),
  iCalUID: CalendarEvent.fields.iCalUID,
  id: Schema.String,
  organizer: CalendarEvent.fields.organizer,
  originalStartTime: Schema.optional(EventTime),
  recurringEventId: Schema.optional(Schema.String),
  status: Schema.optional(CalendarEvent.fields.status),
  summary: Schema.optional(Schema.String),
});

const EventPage = Schema.Struct({
  items: Schema.optional(Schema.Array(GoogleEvent)),
  nextPageToken: Schema.optional(Schema.String),
  nextSyncToken: Schema.optional(Schema.String),
});

const GoogleCalendar = Schema.Struct({
  accessRole: Calendar.fields.accessRole,
  backgroundColor: Schema.optional(Schema.String),
  colorId: Schema.optional(Schema.String),
  defaultReminders: Calendar.fields.defaultReminders,
  foregroundColor: Schema.optional(Schema.String),
  id: Schema.String,
  primary: Schema.optional(Schema.Boolean),
  summary: Schema.optional(Schema.String),
  timeZone: Schema.optional(Schema.String),
});

const CalendarPage = Schema.Struct({
  items: Schema.optional(Schema.Array(GoogleCalendar)),
  nextPageToken: Schema.optional(Schema.String),
});

const decodeResponse = <A>(
  schema: Schema.Codec<A>,
  request: GoogleRequestValue
) =>
  googleRequest(request).pipe(
    Effect.flatMap((response) =>
      Schema.decodeEffect(Schema.fromJsonString(schema))(response.body).pipe(
        Effect.mapError(
          () =>
            new Provider({
              message: "Google returned an invalid Calendar response",
              operation: request.method,
              status: response.status,
            })
        )
      )
    )
  );

const pathFor = (ref: CalendarRefValue) =>
  `/calendars/${encodeURIComponent(ref.calendarId)}/events`;

const eventPath = (ref: EventRefValue) =>
  `${pathFor(ref)}/${encodeURIComponent(ref.eventId)}`;

const mapEvent = (
  ref: CalendarRefValue,
  event: typeof GoogleEvent.Type
): CalendarEventValue => {
  const { id, summary, status, hangoutLink, ...fields } = event;

  return {
    accountId: ref.accountId,
    calendarId: ref.calendarId,
    ...fields,
    conferenceUrl: hangoutLink,
    eventId: id,
    status: status ?? "confirmed",
    title: summary,
  };
};

const mapCalendar = (
  accountId: string,
  calendar: typeof GoogleCalendar.Type
): CalendarValue => {
  const { id, summary, timeZone, primary, ...fields } = calendar;

  return {
    ...fields,
    accountId,
    calendarId: id,
    primary: primary ?? false,
    timeZone: timeZone ?? "UTC",
    title: summary ?? id,
  };
};

const eventBody = (fields: EventFieldsValue) => {
  const { title, ...rest } = fields;

  return { ...rest, summary: title };
};

export interface ListPageInput {
  readonly ref: CalendarRefValue;
  readonly singleEvents: boolean;
  readonly pageToken?: string | undefined;
  readonly syncToken?: string | undefined;
  readonly timeMin?: string | undefined;
  readonly timeMax?: string | undefined;
}

export interface ListedEvents {
  readonly events: readonly CalendarEventValue[];
  readonly nextPageToken: string | undefined;
  readonly nextSyncToken: string | undefined;
}

export interface WriteOptions {
  readonly sendUpdates?: "none" | "all" | "externalOnly" | undefined;
}

export class GoogleCalendarClient extends Context.Service<
  GoogleCalendarClient,
  {
    readonly listPage: (
      input: ListPageInput
    ) => Effect.Effect<ListedEvents, CalendarFailureValue>;
    readonly instancesPage: (
      ref: EventRefValue,
      pageToken?: string
    ) => Effect.Effect<ListedEvents, CalendarFailureValue>;
    readonly calendarsPage: (
      accountId: string,
      pageToken?: string
    ) => Effect.Effect<
      {
        readonly calendars: readonly CalendarValue[];
        readonly nextPageToken: string | undefined;
      },
      CalendarFailureValue
    >;
    readonly getCalendar: (
      ref: CalendarRefValue
    ) => Effect.Effect<CalendarValue, CalendarFailureValue>;
    readonly move: (
      ref: EventRefValue,
      destinationCalendarId: string,
      options: WriteOptions
    ) => Effect.Effect<CalendarEventValue, CalendarFailureValue>;
    readonly colors: (
      accountId: string
    ) => Effect.Effect<ColorsValue, CalendarFailureValue>;
    readonly get: (
      ref: EventRefValue
    ) => Effect.Effect<CalendarEventValue, CalendarFailureValue>;
    readonly create: (
      ref: CalendarRefValue,
      id: string,
      fields: EventFieldsValue,
      options: WriteOptions
    ) => Effect.Effect<CalendarEventValue, CalendarFailureValue>;
    readonly patch: (
      ref: EventRefValue,
      fields: EventFieldsValue,
      options: WriteOptions
    ) => Effect.Effect<CalendarEventValue, CalendarFailureValue>;
    readonly remove: (
      ref: EventRefValue,
      options: WriteOptions
    ) => Effect.Effect<void, CalendarFailureValue>;
    readonly watch: (
      ref: CalendarRefValue,
      id: string,
      address: string,
      token?: string
    ) => Effect.Effect<typeof WatchChannel.Type, CalendarFailureValue>;
    readonly stopWatch: (
      accountId: string,
      id: string,
      resourceId: string
    ) => Effect.Effect<void, CalendarFailureValue>;
  }
>()("@calendar/calendar/GoogleCalendarClient") {
  static readonly layer = Layer.effect(
    GoogleCalendarClient,
    Effect.gen(function* layer() {
      const context = yield* Effect.context<GoogleTokens | GoogleHttp>();

      const request = (input: GoogleRequestValue) =>
        googleRequest(input).pipe(Effect.provide(context));

      const decode = <A>(schema: Schema.Codec<A>, input: GoogleRequestValue) =>
        decodeResponse(schema, input).pipe(Effect.provide(context));

      const get = (ref: EventRefValue) =>
        decode(GoogleEvent, {
          accountId: ref.accountId,
          method: "GET",
          path: eventPath(ref),
        }).pipe(Effect.map((event) => mapEvent(ref, event)));

      return GoogleCalendarClient.of({
        calendarsPage: Effect.fn("GoogleCalendarClient.calendarsPage")(
          function* calendarsPage(accountId, pageToken) {
            const query = new URLSearchParams({ maxResults: "250" });

            if (pageToken !== undefined) {
              query.set("pageToken", pageToken);
            }

            const page = yield* decode(CalendarPage, {
              accountId,
              method: "GET",
              path: `/users/me/calendarList?${query.toString()}`,
            });

            return {
              calendars: (page.items ?? []).map((calendar) =>
                mapCalendar(accountId, calendar)
              ),
              nextPageToken: page.nextPageToken,
            };
          }
        ),
        colors: (accountId) =>
          decode(Colors, { accountId, method: "GET", path: "/colors" }),
        create: Effect.fn("GoogleCalendarClient.create")(
          function* create(ref, id, fields, options) {
            const response = yield* request({
              acceptConflict: true,
              accountId: ref.accountId,
              body: JSON.stringify({ ...eventBody(fields), id }),
              method: "POST",
              path: `${pathFor(ref)}?sendUpdates=${options.sendUpdates ?? "none"}`,
            });

            if (response.status === 409) {
              return yield* get({ ...ref, eventId: id });
            }

            const event = yield* Schema.decodeEffect(
              Schema.fromJsonString(GoogleEvent)
            )(response.body).pipe(
              Effect.mapError(
                () =>
                  new Provider({
                    message: "Google returned an invalid event",
                    operation: "events.insert",
                    status: response.status,
                  })
              )
            );

            return mapEvent(ref, event);
          }
        ),
        get,
        getCalendar: (ref) =>
          decode(GoogleCalendar, {
            accountId: ref.accountId,
            method: "GET",
            path: `/users/me/calendarList/${encodeURIComponent(ref.calendarId)}`,
          }).pipe(
            Effect.map((calendar) => mapCalendar(ref.accountId, calendar))
          ),
        instancesPage: (ref, pageToken) => {
          const query = new URLSearchParams({
            maxResults: "2500",
            showDeleted: "true",
          });

          if (pageToken !== undefined) {
            query.set("pageToken", pageToken);
          }

          return decode(EventPage, {
            accountId: ref.accountId,
            method: "GET",
            path: `${eventPath(ref)}/instances?${query.toString()}`,
          }).pipe(
            Effect.map((page) => ({
              events: (page.items ?? []).map((event) => mapEvent(ref, event)),
              nextPageToken: page.nextPageToken,
              nextSyncToken: page.nextSyncToken,
            }))
          );
        },
        listPage: Effect.fn("GoogleCalendarClient.listPage")(
          function* listPage(input) {
            if (
              input.syncToken !== undefined &&
              (input.timeMin !== undefined || input.timeMax !== undefined)
            ) {
              return yield* new Provider({
                message: "Sync tokens cannot be combined with range filters",
                operation: "events.list",
                status: 0,
              });
            }

            const query = new URLSearchParams({
              maxResults: "2500",
              showDeleted: "true",
              singleEvents: String(input.singleEvents),
            });

            if (input.pageToken !== undefined) {
              query.set("pageToken", input.pageToken);
            }

            if (input.syncToken !== undefined) {
              query.set("syncToken", input.syncToken);
            }

            if (input.timeMin !== undefined) {
              query.set("timeMin", input.timeMin);
            }

            if (input.timeMax !== undefined) {
              query.set("timeMax", input.timeMax);
            }

            const page = yield* decode(EventPage, {
              accountId: input.ref.accountId,
              method: "GET",
              path: `${pathFor(input.ref)}?${query.toString()}`,
            });

            return {
              events: (page.items ?? []).map((event) =>
                mapEvent(input.ref, event)
              ),
              nextPageToken: page.nextPageToken,
              nextSyncToken: page.nextSyncToken,
            };
          }
        ),
        move: (ref, destinationCalendarId, options) => {
          const query = new URLSearchParams({
            destination: destinationCalendarId,
            sendUpdates: options.sendUpdates ?? "none",
          });

          return decode(GoogleEvent, {
            accountId: ref.accountId,
            method: "POST",
            path: `${eventPath(ref)}/move?${query.toString()}`,
          }).pipe(
            Effect.map((event) =>
              mapEvent(
                { accountId: ref.accountId, calendarId: destinationCalendarId },
                event
              )
            )
          );
        },
        patch: (ref, fields, options) =>
          decode(GoogleEvent, {
            accountId: ref.accountId,
            body: JSON.stringify(eventBody(fields)),
            method: "PATCH",
            path: `${eventPath(ref)}?sendUpdates=${options.sendUpdates ?? "none"}`,
          }).pipe(Effect.map((event) => mapEvent(ref, event))),
        remove: (ref, options) =>
          request({
            accountId: ref.accountId,
            method: "DELETE",
            path: `${eventPath(ref)}?sendUpdates=${options.sendUpdates ?? "none"}`,
          }).pipe(
            Effect.asVoid,
            Effect.catchTag(["NotFound", "Gone"], () => Effect.void)
          ),
        stopWatch: (accountId, id, resourceId) =>
          request({
            accountId,
            body: JSON.stringify({ id, resourceId }),
            method: "POST",
            path: "/channels/stop",
          }).pipe(
            Effect.asVoid,
            Effect.catchTag(["NotFound", "Gone"], () => Effect.void)
          ),
        watch: (ref, id, address, token) =>
          decode(WatchChannel, {
            accountId: ref.accountId,
            body: JSON.stringify({ address, id, token, type: "web_hook" }),
            method: "POST",
            path: `${pathFor(ref)}/watch`,
          }),
      });
    })
  );
}
