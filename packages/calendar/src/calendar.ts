import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { CalendarReadFailure } from "./calendar-read-failure.js";
import { CalendarChanges } from "./changes.js";
import type {
  DeleteEventInput,
  ListCalendarsOutput,
  ListEventsInput,
  ListEventsOutput,
  MoveEventInput,
  RsvpInput,
  UpdateEventInput,
} from "./contracts.js";
import { CreateEventInput } from "./contracts.js";
import {
  Provider,
  Revoked,
  CrossAccountMove,
  CalendarMoveRefused,
  ReminderLimitExceeded,
  RecurrenceRemovalRefused,
} from "./errors.js";
import type { CalendarFailureValue } from "./errors.js";
import { GoogleTokens, tokenFailure } from "./google-tokens.js";
import { GoogleCalendarClient } from "./google.js";
import type { WriteOptions } from "./google.js";
import type {
  CalendarValue,
  CalendarEventValue,
  EventRefValue,
  CalendarRefValue,
  EventFieldsValue,
} from "./model.js";
import { EventFields, EventReminders } from "./model.js";
import { googleCalendarCapabilities } from "./provider-capabilities.js";
import { seriesChanges, splitRecurrence, timeValue } from "./recurrence.js";
import { normalizeReminderSet } from "./reminders.js";
import { splitSuccessorId } from "./split-id.js";
import { CalendarStore } from "./store.js";
import { CalendarReadBudget } from "./sync.js";

const refuse = (operation: string, message: string) =>
  new Provider({ message, operation, status: 0 });

const editableFields = (event: CalendarEventValue) =>
  Schema.decodeEffect(EventFields)(event).pipe(
    Effect.mapError(() =>
      refuse("event", "Event contains invalid editable fields")
    )
  );

export class CalendarService extends Context.Service<
  CalendarService,
  {
    readonly listCalendars: () => Effect.Effect<
      typeof ListCalendarsOutput.Type,
      CalendarFailureValue
    >;
    readonly listEvents: (
      input: typeof ListEventsInput.Type
    ) => Effect.Effect<typeof ListEventsOutput.Type, CalendarReadFailure>;
    readonly getEvent: (
      ref: EventRefValue
    ) => Effect.Effect<CalendarEventValue, CalendarReadFailure>;
    readonly createEvent: (
      input: typeof CreateEventInput.Type
    ) => Effect.Effect<CalendarEventValue, CalendarFailureValue>;
    readonly updateEvent: (
      input: typeof UpdateEventInput.Type
    ) => Effect.Effect<CalendarEventValue, CalendarFailureValue>;
    readonly moveEvent: (
      input: typeof MoveEventInput.Type
    ) => Effect.Effect<CalendarEventValue, CalendarFailureValue>;
    readonly deleteEvent: (
      input: typeof DeleteEventInput.Type
    ) => Effect.Effect<void, CalendarFailureValue>;
    readonly rsvp: (
      input: typeof RsvpInput.Type
    ) => Effect.Effect<CalendarEventValue, CalendarFailureValue>;
  }
>()("@calendar/calendar/CalendarService") {
  static readonly layer = Layer.effect(
    CalendarService,
    Effect.gen(function* layer() {
      const google = yield* GoogleCalendarClient;
      const tokens = yield* GoogleTokens;
      const budget = yield* CalendarReadBudget;
      const recurrenceContext = yield* Effect.context<GoogleCalendarClient>();

      const store = yield* CalendarStore;
      const changeSink = yield* CalendarChanges;

      const recordWrite = <A>(
        ref: CalendarRefValue,
        effect: Effect.Effect<A, CalendarFailureValue>
      ) =>
        effect.pipe(
          Effect.tap(() =>
            Effect.gen(function* recordCalendarWrite() {
              const version = yield* store.invalidate(ref);
              yield* changeSink.publish({
                accountId: ref.accountId,
                calendarId: ref.calendarId,
                reason: "write",
                version,
              });
            })
          )
        );

      const prepareFields = Effect.fn("CalendarService.prepareFields")(
        function* prepareFields(
          ref: CalendarRefValue,
          fields: EventFieldsValue
        ) {
          if (fields.reminders === undefined) {
            return fields;
          }

          const reminders = yield* Schema.decodeEffect(EventReminders)(
            fields.reminders
          ).pipe(
            Effect.mapError(() =>
              refuse(
                "reminders",
                "Use email or popup reminders from 0 through 40320 minutes"
              )
            )
          );

          if (reminders.useDefault) {
            return { ...fields, reminders: { useDefault: true } };
          }

          const overrides = reminders.overrides ?? [];

          if (overrides.length > googleCalendarCapabilities.maxRemindersCount) {
            return yield* new ReminderLimitExceeded({
              accountId: ref.accountId,
              actualCount: overrides.length,
              calendarId: ref.calendarId,
              maxRemindersCount: googleCalendarCapabilities.maxRemindersCount,
            });
          }

          const calendar = yield* google.getCalendar(ref);

          return {
            ...fields,
            reminders: normalizeReminderSet(
              overrides,
              calendar.defaultReminders ?? []
            ),
          };
        }
      );

      const patch = (
        ref: EventRefValue,
        fields: EventFieldsValue,
        options: WriteOptions
      ) =>
        prepareFields(ref, fields).pipe(
          Effect.flatMap((prepared) => google.patch(ref, prepared, options))
        );

      const create = (
        ref: CalendarRefValue,
        id: string,
        fields: EventFieldsValue,
        options: WriteOptions
      ) =>
        prepareFields(ref, fields).pipe(
          Effect.flatMap((prepared) =>
            google.create(ref, id, prepared, options)
          )
        );

      const removeRecurrence = Effect.fn("CalendarService.removeRecurrence")(
        function* removeRecurrence(
          input: typeof UpdateEventInput.Type,
          selected: CalendarEventValue
        ) {
          if (selected.recurringEventId === undefined) {
            return yield* patch(
              input,
              { ...input.changes, recurrence: [] },
              input
            );
          }

          if (selected.start === undefined || selected.end === undefined) {
            return yield* new RecurrenceRemovalRefused({
              accountId: input.accountId,
              calendarId: input.calendarId,
              eventId: input.eventId,
              reason: "missingInstanceTimes",
            });
          }

          const master = yield* google.get({
            ...input,
            eventId: selected.recurringEventId,
          });

          return yield* patch(
            master,
            {
              ...input.changes,
              end: input.changes.end ?? selected.end,
              recurrence: [],
              start: input.changes.start ?? selected.start,
            },
            input
          );
        }
      );

      const operations = CalendarService.of({
        createEvent: Effect.fn("CalendarService.createEvent")(
          function* createEvent(input) {
            const valid = yield* Schema.decodeEffect(CreateEventInput)(
              input
            ).pipe(
              Effect.mapError(() =>
                refuse(
                  "createEvent",
                  "Provide a valid base32hex id and event fields"
                )
              )
            );

            if (
              valid.event.start === undefined ||
              valid.event.end === undefined
            ) {
              return yield* refuse(
                "createEvent",
                "New events require start and end times"
              );
            }

            return yield* create(valid, valid.id, valid.event, valid);
          }
        ),
        deleteEvent: Effect.fn("CalendarService.deleteEvent")(
          function* deleteEvent(input) {
            if (input.scope === "single") {
              return yield* google.remove(input, input);
            }

            const selected = yield* google
              .get(input)
              .pipe(Effect.catchTag(["NotFound", "Gone"], () => Effect.void));

            if (selected === undefined) {
              return yield* Effect.void;
            }

            if (selected.recurringEventId === undefined) {
              return yield* google.remove(input, input);
            }

            const master = yield* google.get({
              ...input,
              eventId: selected.recurringEventId,
            });

            if (input.scope === "all") {
              return yield* google.remove(master, input);
            }

            if (selected.organizer?.self !== true) {
              return yield* refuse(
                "deleteEvent",
                "Only the organizer can truncate a recurring series"
              );
            }

            const recurrence = yield* splitRecurrence(master, selected).pipe(
              Effect.provide(recurrenceContext)
            );

            return yield* google
              .patch(master, { recurrence: recurrence.truncate }, input)
              .pipe(Effect.asVoid);
          }
        ),
        getEvent: (ref) =>
          google.get(ref).pipe(
            Effect.mapError(
              (cause) =>
                new CalendarReadFailure({
                  accountId: ref.accountId,
                  calendarId: ref.calendarId,
                  cause,
                })
            )
          ),
        listCalendars: Effect.fn("CalendarService.listCalendars")(
          function* listCalendars() {
            const accounts = yield* tokens
              .accounts()
              .pipe(Effect.mapError(tokenFailure));

            const results: (typeof ListCalendarsOutput.Type.accounts)[number][] =
              [];

            for (const account of accounts) {
              const result = yield* Effect.gen(
                function* listAccountCalendars() {
                  if (account.disconnected) {
                    return yield* new Revoked({ accountId: account.id });
                  }

                  const calendars: CalendarValue[] = [];
                  const colors = yield* google.colors(account.id);
                  const seen = new Set<string>();
                  let pageToken: string | undefined;

                  for (let pageNumber = 0; ; pageNumber += 1) {
                    if (pageNumber >= budget.maxPages) {
                      return yield* refuse(
                        "calendarList",
                        "Calendar listing exceeded its page budget"
                      );
                    }

                    const page = yield* google.calendarsPage(
                      account.id,
                      pageToken
                    );

                    calendars.push(...page.calendars);

                    if (page.nextPageToken === undefined) {
                      break;
                    }

                    if (seen.has(page.nextPageToken)) {
                      return yield* refuse(
                        "calendarList",
                        "Google repeated a calendar page token"
                      );
                    }

                    seen.add(page.nextPageToken);
                    pageToken = page.nextPageToken;
                  }

                  return { accountId: account.id, calendars, colors };
                }
              ).pipe(
                Effect.catch((error) =>
                  Effect.succeed({ accountId: account.id, failure: error })
                )
              );

              results.push(result);
            }

            return { accounts: results };
          }
        ),
        listEvents: Effect.fn("CalendarService.listEvents")(
          function* listEvents({ range, calendars }) {
            const events: CalendarEventValue[] = [];

            const versions: {
              accountId: string;
              calendarId: string;
              version: number;
            }[] = [];

            for (const ref of calendars) {
              const result = yield* Effect.gen(function* listCalendarRange() {
                const start = yield* timeValue({ dateTime: range.start });
                const end = yield* timeValue({ dateTime: range.end });

                if (
                  DateTime.toEpochMillis(start) >= DateTime.toEpochMillis(end)
                ) {
                  return yield* refuse(
                    "listEvents",
                    "Range start must precede range end"
                  );
                }

                const snapshot = yield* store.read(ref);
                versions.push({ ...ref, version: snapshot.version });

                const cached = yield* store.readRange(
                  ref,
                  range,
                  snapshot.version
                );

                if (cached !== undefined) {
                  return cached;
                }

                const calendarEvents: CalendarEventValue[] = [];
                const seen = new Set<string>();
                let pageToken: string | undefined;

                for (let pageNumber = 0; ; pageNumber += 1) {
                  if (pageNumber >= budget.maxPages) {
                    return yield* refuse(
                      "listEvents",
                      "Range listing exceeded its page budget"
                    );
                  }

                  const page = yield* google.listPage({
                    pageToken,
                    ref,
                    singleEvents: true,
                    timeMax: range.end,
                    timeMin: range.start,
                  });

                  calendarEvents.push(
                    ...page.events.filter(
                      (event) => event.status !== "cancelled"
                    )
                  );

                  if (page.nextPageToken === undefined) {
                    break;
                  }

                  if (seen.has(page.nextPageToken)) {
                    return yield* refuse(
                      "listEvents",
                      "Google repeated a range page token"
                    );
                  }

                  seen.add(page.nextPageToken);
                  pageToken = page.nextPageToken;
                }

                const cachedVersion = yield* store.cacheRange(
                  ref,
                  range,
                  snapshot.version,
                  calendarEvents
                );

                if (!cachedVersion) {
                  return yield* refuse(
                    "listEvents",
                    "Calendar changed while loading this range; retry"
                  );
                }

                return calendarEvents;
              }).pipe(
                Effect.mapError(
                  (cause) =>
                    new CalendarReadFailure({
                      accountId: ref.accountId,
                      calendarId: ref.calendarId,
                      cause,
                    })
                )
              );

              events.push(...result);
            }

            return { events, versions };
          }
        ),
        moveEvent: Effect.fn("CalendarService.moveEvent")(
          function* moveEvent(input) {
            if (input.accountId !== input.destination.accountId) {
              return yield* new CrossAccountMove({
                destinationAccountId: input.destination.accountId,
                sourceAccountId: input.accountId,
              });
            }

            const selected = yield* google.get(input);

            if (selected.recurringEventId !== undefined) {
              return yield* new CalendarMoveRefused({
                accountId: input.accountId,
                calendarId: input.calendarId,
                eventId: input.eventId,
                reason: "recurringInstance",
                recurringEventId: selected.recurringEventId,
              });
            }

            if (
              selected.eventType !== undefined &&
              selected.eventType !== "default"
            ) {
              return yield* new CalendarMoveRefused({
                accountId: input.accountId,
                calendarId: input.calendarId,
                eventId: input.eventId,
                eventType: selected.eventType,
                reason: "eventType",
              });
            }

            if (input.calendarId === input.destination.calendarId) {
              return selected;
            }

            return yield* recordWrite(
              input.destination,
              recordWrite(
                input,
                google.move(input, input.destination.calendarId, input)
              )
            );
          }
        ),
        rsvp: Effect.fn("CalendarService.rsvp")(function* rsvp(input) {
          const event = yield* google.get(input);
          const attendees = event.attendees ?? [];

          if (!attendees.some((attendee) => attendee.self === true)) {
            return yield* refuse(
              "rsvp",
              "Google omitted the self attendee; cannot safely answer for this account"
            );
          }

          return yield* google.patch(
            input,
            {
              attendees: attendees
                .filter((attendee) => attendee.self === true)
                .map((attendee) => ({
                  ...attendee,
                  comment: input.note ?? attendee.comment,
                  responseStatus: input.response,
                })),
              attendeesOmitted: true,
            },
            input
          );
        }),
        updateEvent: Effect.fn("CalendarService.updateEvent")(
          function* updateEvent(input) {
            if (
              input.removeRecurrence !== true &&
              input.changes.recurrence?.length === 0
            ) {
              return yield* new RecurrenceRemovalRefused({
                accountId: input.accountId,
                calendarId: input.calendarId,
                eventId: input.eventId,
                reason: "explicitRemovalRequired",
              });
            }

            if (input.removeRecurrence === true && input.scope !== "all") {
              return yield* new RecurrenceRemovalRefused({
                accountId: input.accountId,
                calendarId: input.calendarId,
                eventId: input.eventId,
                reason: "wholeSeriesRequired",
              });
            }

            if (
              input.removeRecurrence === true &&
              (input.changes.recurrence?.length ?? 0) > 0
            ) {
              return yield* new RecurrenceRemovalRefused({
                accountId: input.accountId,
                calendarId: input.calendarId,
                eventId: input.eventId,
                reason: "conflictingRules",
              });
            }

            const selected = yield* google.get(input);

            if (input.removeRecurrence === true) {
              return yield* removeRecurrence(input, selected);
            }

            if (
              input.scope === "single" ||
              selected.recurringEventId === undefined
            ) {
              return yield* patch(input, input.changes, input);
            }

            const master = yield* google.get({
              ...input,
              eventId: selected.recurringEventId,
            });

            if (input.scope === "all") {
              const changes = yield* seriesChanges(
                master,
                selected,
                input.changes
              );

              return yield* patch(master, changes, input);
            }

            if (selected.organizer?.self !== true) {
              return yield* refuse(
                "updateEvent",
                "Only the organizer can split a recurring series"
              );
            }

            const recurrence = yield* splitRecurrence(master, selected).pipe(
              Effect.provide(recurrenceContext)
            );

            const fields = yield* editableFields(master);

            const successorId = yield* splitSuccessorId(master, selected);

            const successor = yield* recordWrite(
              input,
              create(
                input,
                successorId,
                {
                  ...fields,
                  end: selected.end,
                  recurrence: recurrence.successor,
                  start: selected.start,
                  ...input.changes,
                },
                input
              )
            );

            yield* google.patch(
              master,
              { recurrence: recurrence.truncate },
              input
            );

            return successor;
          }
        ),
      });

      return CalendarService.of({
        ...operations,
        createEvent: (input) =>
          recordWrite(input, operations.createEvent(input)),
        deleteEvent: (input) =>
          recordWrite(input, operations.deleteEvent(input)),
        rsvp: (input) => recordWrite(input, operations.rsvp(input)),
        updateEvent: (input) =>
          recordWrite(input, operations.updateEvent(input)),
      });
    })
  );
}
