import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Match, Predicate, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { CalendarService } from "../src/calendar.js";
import { CalendarChanges } from "../src/changes.js";
import type { CalendarChangedValue } from "../src/changes.js";
import {
  CalendarMoveRefused,
  CrossAccountMove,
  RecurrenceRemovalRefused,
  ReminderLimitExceeded,
} from "../src/errors.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import { Reminder, SendUpdates } from "../src/model.js";
import type { CalendarEventValue } from "../src/model.js";
import { googleCalendarCapabilities } from "../src/provider-capabilities.js";
import { CalendarStore } from "../src/store.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const start = { dateTime: "2026-03-15T16:00:00Z" };

const end = { dateTime: "2026-03-15T17:00:00Z" };

const range = { end: "2026-04-01T00:00:00Z", start: "2026-03-01T00:00:00Z" };

const bodySchema = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Json)
);

const defaultsArbitrary = Arbitrary.schema(
  Schema.Array(Reminder).check(
    Schema.isMaxLength(googleCalendarCapabilities.maxRemindersCount)
  )
);

const serviceLayer = (
  fake: Effect.Success<ReturnType<typeof fakeGoogle>>,
  publish: (value: CalendarChangedValue) => Effect.Effect<void> = () =>
    Effect.void
) =>
  CalendarService.layer.pipe(
    Layer.provideMerge(
      GoogleCalendarClient.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            fake.layer,
            memoryCalendarStore,
            Layer.succeed(CalendarChanges, { publish })
          )
        )
      )
    )
  );

const calendarResponse = (
  defaultReminders: readonly (typeof Reminder.Type)[]
) =>
  response(200, { accessRole: "owner", defaultReminders, id: ref.calendarId });

const times = (allDay: boolean, day: number) =>
  allDay
    ? {
        end: { date: `2026-03-${String(day + 1).padStart(2, "0")}` },
        start: { date: `2026-03-${String(day).padStart(2, "0")}` },
      }
    : {
        end: { dateTime: `2026-03-${String(day).padStart(2, "0")}T17:00:00Z` },
        start: {
          dateTime: `2026-03-${String(day).padStart(2, "0")}T16:00:00Z`,
        },
      };

describe("calendar editing domain rules", () => {
  it.effect.prop(
    "calendar listing exposes the authenticated calendar's default reminders",
    { defaults: defaultsArbitrary },
    ({ defaults }) =>
      Effect.gen(function* listDefaults() {
        const fake = yield* fakeGoogle([
          response(200, { calendar: {}, event: {} }),
          response(200, {
            items: [
              {
                accessRole: "owner",
                defaultReminders: defaults,
                id: ref.calendarId,
              },
            ],
          }),
        ]);

        const listed = yield* CalendarService.use((calendar) =>
          calendar.listCalendars()
        ).pipe(Effect.provide(serviceLayer(fake)));

        const [account] = listed.accounts;

        if (account === undefined || !("calendars" in account)) {
          return yield* Effect.die(
            new Error("Expected a successful calendar listing")
          );
        }

        expect(account.calendars[0]?.defaultReminders).toEqual(defaults);

        return yield* Effect.void;
      })
  );

  it.effect.prop(
    "create and update collapse explicit sets equal to fresh calendar defaults regardless of ordering",
    { defaults: defaultsArbitrary, update: Arbitrary.schema(Schema.Boolean) },
    ({ defaults, update }) =>
      Effect.gen(function* inheritedDefaults() {
        const fake = yield* fakeGoogle([
          ...(update ? [response(200, timedEvent("event"))] : []),
          calendarResponse(defaults),
          response(200, timedEvent("event")),
        ]);

        yield* CalendarService.use((calendar) =>
          update
            ? calendar.updateEvent({
                ...ref,
                changes: {
                  reminders: {
                    overrides: defaults.toReversed(),
                    useDefault: false,
                  },
                },
                eventId: "event",
                scope: "single",
              })
            : calendar.createEvent({
                ...ref,
                event: {
                  end,
                  reminders: {
                    overrides: defaults.toReversed(),
                    useDefault: false,
                  },
                  start,
                },
                id: "abcde",
              })
        ).pipe(Effect.provide(serviceLayer(fake)));
        const requests = yield* Ref.get(fake.requests);
        expect(requests.at(-2)?.path).toBe("/users/me/calendarList/calendar");

        const body = yield* Schema.decodeEffect(bodySchema)(
          requests.at(-1)?.body ?? ""
        );

        expect(body.reminders).toEqual({ useDefault: true });
      })
  );

  it.effect.prop(
    "different reminder methods, minutes, and explicit disabling do not inherit defaults",
    { kind: Arbitrary.schema(Schema.Literals(["method", "minute", "empty"])) },
    ({ kind }) =>
      Effect.gen(function* explicitReminders() {
        const selected = Match.value(kind).pipe(
          Match.when("method", () => [
            Reminder.make({ method: "popup", minutes: 10 }),
          ]),
          Match.when("minute", () => [
            Reminder.make({ method: "email", minutes: 20 }),
          ]),
          Match.when("empty", () => []),
          Match.exhaustive
        );

        const fake = yield* fakeGoogle([
          calendarResponse([{ method: "email", minutes: 10 }]),
          response(200, timedEvent("event")),
        ]);

        yield* CalendarService.use((calendar) =>
          calendar.createEvent({
            ...ref,
            event: {
              end,
              reminders: { overrides: selected, useDefault: false },
              start,
            },
            id: "abcde",
          })
        ).pipe(Effect.provide(serviceLayer(fake)));
        const requests = yield* Ref.get(fake.requests);

        const body = yield* Schema.decodeEffect(bodySchema)(
          requests.at(-1)?.body ?? ""
        );

        expect(body.reminders).toEqual({
          overrides: selected,
          useDefault: false,
        });
      })
  );

  it.effect(
    "inherited reminders discard stale overrides without an extra default lookup",
    () =>
      Effect.gen(function* explicitInheritance() {
        const fake = yield* fakeGoogle([response(200, timedEvent("event"))]);
        yield* CalendarService.use((calendar) =>
          calendar.createEvent({
            ...ref,
            event: {
              end,
              reminders: {
                overrides: [{ method: "popup", minutes: 10 }],
                useDefault: true,
              },
              start,
            },
            id: "abcde",
          })
        ).pipe(Effect.provide(serviceLayer(fake)));
        const requests = yield* Ref.get(fake.requests);
        expect(requests).toHaveLength(1);

        const body = yield* Schema.decodeEffect(bodySchema)(
          requests[0]?.body ?? ""
        );

        expect(body.reminders).toEqual({ useDefault: true });
      })
  );

  it.effect.prop(
    "the provider reminder maximum rejects excess overrides before a provider write",
    { update: Arbitrary.schema(Schema.Boolean) },
    ({ update }) =>
      Effect.gen(function* reminderLimit() {
        const fake = yield* fakeGoogle(
          update ? [response(200, timedEvent("event"))] : []
        );

        const overrides = Array.from(
          { length: googleCalendarCapabilities.maxRemindersCount + 1 },
          (_, minutes) => Reminder.make({ method: "popup", minutes })
        );

        const failure = yield* CalendarService.use((calendar) =>
          update
            ? calendar.updateEvent({
                ...ref,
                changes: { reminders: { overrides, useDefault: false } },
                eventId: "event",
                scope: "single",
              })
            : calendar.createEvent({
                ...ref,
                event: {
                  end,
                  reminders: { overrides, useDefault: false },
                  start,
                },
                id: "abcde",
              })
        ).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

        expect(failure).toEqual(
          new ReminderLimitExceeded({
            ...ref,
            actualCount: overrides.length,
            maxRemindersCount: googleCalendarCapabilities.maxRemindersCount,
          })
        );
        expect(
          (yield* Ref.get(fake.requests)).every(
            (request) => request.method === "GET"
          )
        ).toBe(true);
      })
  );

  it.effect.prop(
    "a whole-event or series move uses events.move and invalidates only its two calendars",
    {
      explicitUpdates: Arbitrary.schema(Schema.Boolean),
      series: Arbitrary.schema(Schema.Boolean),
      updates: Arbitrary.schema(SendUpdates),
    },
    ({ series, explicitUpdates, updates }) =>
      Effect.gen(function* moveCalendars() {
        const destination = {
          ...ref,
          calendarId: "destination /team@example.test",
        };

        const unrelated = { ...ref, calendarId: "unrelated" };

        const selected = timedEvent(
          "event",
          "Meeting",
          series ? { recurrence: ["RRULE:FREQ=WEEKLY;COUNT=5"] } : {}
        );

        const fake = yield* fakeGoogle([
          response(200, selected),
          response(
            200,
            timedEvent("moved", "Meeting", {
              iCalUID: "event@fake.test",
              recurrence: series ? ["RRULE:FREQ=WEEKLY;COUNT=5"] : [],
            })
          ),
        ]);

        const published = yield* Ref.make<readonly CalendarChangedValue[]>([]);
        yield* Effect.gen(function* verifyMove() {
          const calendar = yield* CalendarService;
          const store = yield* CalendarStore;

          const cached: CalendarEventValue = {
            ...ref,
            end,
            eventId: "event",
            start,
            status: "confirmed",
          };

          for (const calendarRef of [ref, destination, unrelated]) {
            expect(
              yield* store.cacheRange(calendarRef, range, 0, [
                { ...cached, ...calendarRef },
              ])
            ).toBe(true);
          }

          const moved = yield* calendar.moveEvent({
            ...ref,
            destination,
            eventId: "event",
            sendUpdates: explicitUpdates ? updates : undefined,
          });

          expect(moved.accountId).toBe(ref.accountId);
          expect(moved.calendarId).toBe(destination.calendarId);
          expect(moved.eventId).toBe("moved");
          expect(moved.recurrence).toEqual(
            series ? ["RRULE:FREQ=WEEKLY;COUNT=5"] : []
          );
          expect((yield* store.read(ref)).version).toBe(1);
          expect((yield* store.read(destination)).version).toBe(1);
          expect((yield* store.read(unrelated)).version).toBe(0);
          expect(yield* store.readRange(ref, range, 0)).toBeUndefined();
          expect(yield* store.readRange(destination, range, 0)).toBeUndefined();
          expect(yield* store.readRange(unrelated, range, 0)).toHaveLength(1);
          expect(yield* Ref.get(published)).toEqual([
            { ...ref, reason: "write", version: 1 },
            { ...destination, reason: "write", version: 1 },
          ]);
        }).pipe(
          Effect.provide(
            serviceLayer(fake, (change) =>
              Ref.update(published, (previous) => [...previous, change])
            )
          )
        );
        const requests = yield* Ref.get(fake.requests);
        expect(requests.map((request) => request.method)).toEqual([
          "GET",
          "POST",
        ]);
        const [, move] = requests;
        expect(move?.body).toBeUndefined();
        const url = new URL(`https://fake.test${move?.path}`);
        expect(url.pathname).toBe("/calendars/calendar/events/event/move");
        expect(url.searchParams.get("destination")).toBe(
          destination.calendarId
        );
        expect(url.searchParams.get("sendUpdates")).toBe(
          explicitUpdates ? updates : "none"
        );
      })
  );

  it.effect(
    "cross-account moves fail typed without reads, creates, or deletes",
    () =>
      Effect.gen(function* refuseCrossAccountMove() {
        const fake = yield* fakeGoogle();

        const failure = yield* CalendarService.use((calendar) =>
          calendar.moveEvent({
            ...ref,
            destination: {
              accountId: "other-account",
              calendarId: "destination",
            },
            eventId: "event",
          })
        ).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

        expect(failure).toEqual(
          new CrossAccountMove({
            destinationAccountId: "other-account",
            sourceAccountId: ref.accountId,
          })
        );
        expect(yield* Ref.get(fake.requests)).toEqual([]);
      })
  );

  it.effect.prop(
    "moves refuse recurring instances and unsupported Google event types before POST",
    {
      eventType: Arbitrary.schema(
        Schema.Literals([
          "focusTime",
          "outOfOffice",
          "workingLocation",
          "birthday",
          "fromGmail",
        ])
      ),
      instance: Arbitrary.schema(Schema.Boolean),
    },
    ({ instance, eventType }) =>
      Effect.gen(function* refuseUnsupportedMove() {
        const fake = yield* fakeGoogle([
          response(
            200,
            timedEvent(
              "event",
              "Meeting",
              instance
                ? { originalStartTime: start, recurringEventId: "master" }
                : { eventType }
            )
          ),
        ]);

        const failure = yield* CalendarService.use((calendar) =>
          calendar.moveEvent({
            ...ref,
            destination: { ...ref, calendarId: "destination" },
            eventId: "event",
          })
        ).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

        expect(failure).toBeInstanceOf(CalendarMoveRefused);

        if (Predicate.isTagged(failure, "CalendarMoveRefused")) {
          expect(failure.reason).toBe(
            instance ? "recurringInstance" : "eventType"
          );
          expect(failure.recurringEventId).toBe(
            instance ? "master" : undefined
          );
        }

        expect(
          (yield* Ref.get(fake.requests)).map((request) => request.method)
        ).toEqual(["GET"]);
      })
  );

  it.effect.prop(
    "explicit recurrence removal keeps the selected occurrence or moved exception, not the first date",
    {
      allDay: Arbitrary.schema(Schema.Boolean),
      changedTimes: Arbitrary.schema(Schema.Boolean),
      selection: Arbitrary.schema(
        Schema.Literals(["master", "first", "third", "moved"])
      ),
      title: Arbitrary.schema(Schema.String),
    },
    ({ allDay, selection, changedTimes, title }) =>
      Effect.gen(function* removeSelectedRecurrence() {
        const masterTimes = times(allDay, 1);

        const selectedDay = Match.value(selection).pipe(
          Match.when("third", () => 15),
          Match.when("moved", () => 18),
          Match.orElse(() => 1)
        );

        const selectedTimes = times(allDay, selectedDay);
        const changed = times(allDay, 25);
        const expectedTimes = changedTimes ? changed : selectedTimes;

        const master = timedEvent("master", "Meeting", {
          ...masterTimes,
          recurrence: ["RRULE:FREQ=WEEKLY;COUNT=5"],
        });

        const selected =
          selection === "master"
            ? master
            : timedEvent("instance", "Meeting", {
                ...selectedTimes,
                originalStartTime: times(
                  allDay,
                  selection === "moved" ? 15 : selectedDay
                ).start,
                recurringEventId: "master",
              });

        const fake = yield* fakeGoogle([
          response(200, selected),
          ...(selection === "master" ? [] : [response(200, master)]),
          response(
            200,
            timedEvent("master", title, { ...expectedTimes, recurrence: [] })
          ),
        ]);

        yield* CalendarService.use((calendar) =>
          calendar.updateEvent({
            ...ref,
            changes: {
              description: "Keep this edit",
              end: changedTimes ? changed.end : undefined,
              start: changedTimes ? changed.start : undefined,
              title,
            },
            eventId: selection === "master" ? "master" : "instance",
            removeRecurrence: true,
            scope: "all",
          })
        ).pipe(Effect.provide(serviceLayer(fake)));
        const requests = yield* Ref.get(fake.requests);
        const patch = requests.at(-1);
        expect(patch?.method).toBe("PATCH");
        expect(patch?.path).toContain("/events/master?");
        const body = yield* Schema.decodeEffect(bodySchema)(patch?.body ?? "");
        expect(body.recurrence).toEqual([]);

        if (selection !== "master" || changedTimes) {
          expect(body.start).toEqual(expectedTimes.start);
          expect(body.end).toEqual(expectedTimes.end);
        } else {
          expect(body.start).toBeUndefined();
          expect(body.end).toBeUndefined();
        }

        expect(body.summary).toBe(title);
        expect(body.description).toBe("Keep this edit");
      })
  );

  it.effect.prop(
    "recurrence removal requires an explicit whole-series operation and usable instance times",
    {
      reason: Arbitrary.schema(
        Schema.Literals([
          "explicitRemovalRequired",
          "wholeSeriesRequired",
          "conflictingRules",
          "missingInstanceTimes",
        ])
      ),
    },
    ({ reason }) =>
      Effect.gen(function* removalGuards() {
        const fake = yield* fakeGoogle(
          reason === "missingInstanceTimes"
            ? [response(200, { id: "instance", recurringEventId: "master" })]
            : []
        );

        const failure = yield* CalendarService.use((calendar) =>
          Match.value(reason).pipe(
            Match.when("explicitRemovalRequired", () =>
              calendar.updateEvent({
                ...ref,
                changes: { recurrence: [] },
                eventId: "instance",
                scope: "all",
              })
            ),
            Match.when("wholeSeriesRequired", () =>
              calendar.updateEvent({
                ...ref,
                changes: {},
                eventId: "instance",
                removeRecurrence: true,
                scope: "single",
              })
            ),
            Match.when("conflictingRules", () =>
              calendar.updateEvent({
                ...ref,
                changes: { recurrence: ["RRULE:FREQ=DAILY"] },
                eventId: "instance",
                removeRecurrence: true,
                scope: "all",
              })
            ),
            Match.when("missingInstanceTimes", () =>
              calendar.updateEvent({
                ...ref,
                changes: {},
                eventId: "instance",
                removeRecurrence: true,
                scope: "all",
              })
            ),
            Match.exhaustive
          )
        ).pipe(Effect.flip, Effect.provide(serviceLayer(fake)));

        expect(failure).toEqual(
          new RecurrenceRemovalRefused({ ...ref, eventId: "instance", reason })
        );
        expect(
          (yield* Ref.get(fake.requests)).every(
            (request) => request.method === "GET"
          )
        ).toBe(true);
      })
  );
});
