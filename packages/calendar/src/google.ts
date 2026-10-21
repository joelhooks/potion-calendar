import { Context, Effect, Layer, Option, Schema } from "effect";
import type { Crypto } from "effect";

import type { ConferencingWriteRequestValue } from "./conferencing-model.js";
import { Provider } from "./errors.js";
import type { CalendarFailureValue } from "./errors.js";
import {
  GoogleConferenceData,
  googleConferencing,
  requestedConferenceData,
  conferencingReadback,
} from "./google-conferencing.js";
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
import type { CalendarAppearancePatch } from "./settings-contracts.js";
import { googleRequest, GoogleRetryPolicy } from "./transport.js";
import type { GoogleRequestValue, GoogleHttp } from "./transport.js";

const GoogleEvent = Schema.Struct({
  ...EventFields.fields,
  attachments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        fileUrl: Schema.String,
        iconLink: Schema.optional(Schema.String),
        mimeType: Schema.optional(Schema.String),
        title: Schema.optional(Schema.String),
      })
    )
  ),
  conferenceData: Schema.optional(Schema.NullOr(GoogleConferenceData)),
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

const SearchPage = Schema.Struct({
  items: Schema.optional(Schema.Array(Schema.Unknown)),
  nextPageToken: Schema.optional(Schema.String),
  nextSyncToken: Schema.optional(Schema.String),
});

const GoogleCalendar = Schema.Struct({
  accessRole: Calendar.fields.accessRole,
  backgroundColor: Schema.optional(Schema.String),
  colorId: Schema.optional(Schema.String),
  conferenceProperties: Schema.optional(
    Schema.Struct({
      allowedConferenceSolutionTypes: Schema.Array(Schema.String),
    })
  ),
  defaultReminders: Calendar.fields.defaultReminders,
  foregroundColor: Schema.optional(Schema.String),
  hidden: Calendar.fields.hidden,
  id: Schema.String,
  primary: Schema.optional(Schema.Boolean),
  selected: Calendar.fields.selected,
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
  const {
    id,
    summary,
    status,
    hangoutLink,
    conferenceData,
    attachments,
    ...fields
  } = event;

  return {
    accountId: ref.accountId,
    calendarId: ref.calendarId,
    ...fields,
    attachments: (attachments ?? []).map((attachment) => ({
      iconUrl: attachment.iconLink,
      mimeType: attachment.mimeType,
      title: attachment.title,
      url: attachment.fileUrl,
    })),
    ...googleConferencing(conferenceData, hangoutLink),
    eventId: id,
    status: status ?? "confirmed",
    title: summary,
  };
};

const confirmCreatedType = (
  event: CalendarEventValue,
  requestedType: EventFieldsValue["eventType"],
  status: number
) =>
  (requestedType === "focusTime" || requestedType === "outOfOffice") &&
  event.eventType !== requestedType
    ? Effect.fail(
        new Provider({
          message:
            "Google did not confirm the requested event type. Check the calendar before creating another event.",
          operation: "events.insert",
          status,
        })
      )
    : Effect.succeed(event);

const mapCalendar = (
  accountId: string,
  calendar: typeof GoogleCalendar.Type
): CalendarValue => {
  const { id, summary, timeZone, primary, conferenceProperties, ...fields } =
    calendar;

  return {
    ...fields,
    accountId,
    allowedConferenceSolutionTypes:
      conferenceProperties?.allowedConferenceSolutionTypes,
    calendarId: id,
    primary: primary ?? false,
    timeZone: timeZone ?? "UTC",
    title: summary ?? id,
  };
};

const eventBody = (
  fields: EventFieldsValue,
  copyAttachments = false,
  creation = false
) => {
  const {
    title,
    attachments,
    eventType,
    focusTimeProperties,
    outOfOfficeProperties,
    ...rest
  } = fields;

  const body = {
    ...rest,
    attachments: copyAttachments
      ? attachments?.map((attachment) => ({
          fileUrl: attachment.url,
          iconLink: attachment.iconUrl,
          mimeType: attachment.mimeType,
          title: attachment.title,
        }))
      : undefined,
    summary: title,
  };

  if (creation) {
    return { ...body, eventType, focusTimeProperties, outOfOfficeProperties };
  }

  return body;
};

export interface ListPageInput {
  readonly ref: CalendarRefValue;
  readonly singleEvents: boolean;
  readonly q?: string | undefined;
  readonly maxResults?: number | undefined;
  readonly orderBy?: "startTime" | "updated" | undefined;
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
  readonly conferencingRequest?: ConferencingWriteRequestValue | undefined;
  readonly sendUpdates?: "none" | "all" | "externalOnly" | undefined;
}

interface AttemptOptions extends WriteOptions {
  readonly singleAttempt?: true;
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
    readonly patchCalendar: (
      ref: CalendarRefValue,
      changes: typeof CalendarAppearancePatch.Type
    ) => Effect.Effect<CalendarValue, CalendarFailureValue>;
    readonly move: (
      ref: EventRefValue,
      destinationCalendarId: string,
      options: AttemptOptions
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
      options: AttemptOptions
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
      const context = yield* Effect.context<
        GoogleTokens | GoogleHttp | Crypto.Crypto
      >();

      const request = (input: GoogleRequestValue, singleAttempt = false) => {
        const operation = googleRequest(input);

        return (
          singleAttempt
            ? operation.pipe(
                Effect.provideService(GoogleRetryPolicy, {
                  baseDelayMs: 0,
                  retries: 0,
                })
              )
            : operation
        ).pipe(Effect.provide(context));
      };

      const decode = <A>(
        schema: Schema.Codec<A>,
        input: GoogleRequestValue,
        singleAttempt = false
      ) => {
        const operation = singleAttempt
          ? decodeResponse(schema, input).pipe(
              Effect.provideService(GoogleRetryPolicy, {
                baseDelayMs: 0,
                retries: 0,
              })
            )
          : decodeResponse(schema, input);

        return operation.pipe(Effect.provide(context));
      };

      const get = (ref: EventRefValue) =>
        decode(GoogleEvent, {
          accountId: ref.accountId,
          method: "GET",
          path: eventPath(ref),
        }).pipe(Effect.map((event) => mapEvent(ref, event)));

      const readConferencingBack = (
        ref: EventRefValue,
        fallback: CalendarEventValue,
        conferencingRequest: ConferencingWriteRequestValue
      ) =>
        get(ref).pipe(
          Effect.map((event) =>
            conferencingReadback(event, conferencingRequest)
          ),
          Effect.orElseSucceed((): CalendarEventValue => ({
            ...fallback,
            conferencingStatus: "unconfirmed",
          }))
        );

      return GoogleCalendarClient.of({
        calendarsPage: Effect.fn("GoogleCalendarClient.calendarsPage")(
          function* calendarsPage(accountId, pageToken) {
            const query = new URLSearchParams({
              maxResults: "250",
              showHidden: "true",
            });

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
            const conferenceData = yield* requestedConferenceData(
              options.conferencingRequest
            ).pipe(Effect.provide(context));

            const query = new URLSearchParams({
              sendUpdates: options.sendUpdates ?? "none",
            });

            if (
              fields.attachments !== undefined &&
              fields.attachments.length > 0
            ) {
              query.set("supportsAttachments", "true");
            }

            if (options.conferencingRequest !== undefined) {
              query.set("conferenceDataVersion", "1");
            }

            const response = yield* request(
              {
                acceptConflict: true,
                accountId: ref.accountId,
                body: JSON.stringify({
                  ...eventBody(fields, true, true),
                  conferenceData,
                  id,
                }),
                method: "POST",
                path: `${pathFor(ref)}?${query.toString()}`,
              },
              fields.eventType === "focusTime" ||
                fields.eventType === "outOfOffice"
            );

            if (response.status === 409) {
              const existing = yield* get({ ...ref, eventId: id }).pipe(
                Effect.flatMap((event) =>
                  confirmCreatedType(event, fields.eventType, 409)
                )
              );

              return options.conferencingRequest === undefined
                ? existing
                : conferencingReadback(existing, options.conferencingRequest);
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

            const inserted = yield* confirmCreatedType(
              mapEvent(ref, event),
              fields.eventType,
              response.status
            );

            if (options.conferencingRequest !== undefined) {
              return yield* readConferencingBack(
                { ...ref, eventId: event.id },
                inserted,
                options.conferencingRequest
              );
            }

            return inserted;
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
              (input.timeMin !== undefined ||
                input.timeMax !== undefined ||
                input.q !== undefined ||
                input.orderBy !== undefined)
            ) {
              return yield* new Provider({
                message:
                  "Sync tokens cannot be combined with range or search filters",
                operation: "events.list",
                status: 0,
              });
            }

            const query = new URLSearchParams({
              maxResults: String(input.maxResults ?? 2500),
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

            if (input.q !== undefined) {
              query.set("q", input.q);
            }

            if (input.orderBy !== undefined) {
              query.set("orderBy", input.orderBy);
            }

            const pageRequest: GoogleRequestValue = {
              accountId: input.ref.accountId,
              method: "GET",
              path: `${pathFor(input.ref)}?${query.toString()}`,
            };

            if (input.q !== undefined) {
              const page = yield* decode(SearchPage, pageRequest);

              const events = (page.items ?? []).flatMap((item) => {
                const event = Schema.decodeUnknownOption(GoogleEvent)(item);

                if (Option.isNone(event)) {
                  return [];
                }

                return Option.toArray(
                  Schema.decodeOption(CalendarEvent)(
                    mapEvent(input.ref, event.value)
                  )
                );
              });

              return {
                events,
                nextPageToken: page.nextPageToken,
                nextSyncToken: page.nextSyncToken,
              };
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

          return decode(
            GoogleEvent,
            {
              accountId: ref.accountId,
              method: "POST",
              path: `${eventPath(ref)}/move?${query.toString()}`,
            },
            options.singleAttempt
          ).pipe(
            Effect.map((event) =>
              mapEvent(
                { accountId: ref.accountId, calendarId: destinationCalendarId },
                event
              )
            )
          );
        },
        patch: Effect.fn("GoogleCalendarClient.patch")(
          function* patch(ref, fields, options) {
            const conferenceData = yield* requestedConferenceData(
              options.conferencingRequest
            ).pipe(Effect.provide(context));

            const query = new URLSearchParams({
              sendUpdates: options.sendUpdates ?? "none",
            });

            if (options.conferencingRequest !== undefined) {
              query.set("conferenceDataVersion", "1");
            }

            const event = yield* decode(
              GoogleEvent,
              {
                accountId: ref.accountId,
                body: JSON.stringify({ ...eventBody(fields), conferenceData }),
                method: "PATCH",
                path: `${eventPath(ref)}?${query.toString()}`,
              },
              options.singleAttempt
            );

            if (options.conferencingRequest !== undefined) {
              return yield* readConferencingBack(
                ref,
                mapEvent(ref, event),
                options.conferencingRequest
              );
            }

            return mapEvent(ref, event);
          }
        ),
        patchCalendar: (ref, changes) =>
          decode(GoogleCalendar, {
            accountId: ref.accountId,
            body: JSON.stringify(changes),
            method: "PATCH",
            path: `/users/me/calendarList/${encodeURIComponent(ref.calendarId)}`,
          }).pipe(
            Effect.map((calendar) => mapCalendar(ref.accountId, calendar))
          ),
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
