import { createFakeAuth } from "@calendar/auth/dev/fake-google";
import { authContext } from "@calendar/auth/google";
import {
  ConnectedGoogleAccount,
  googleTokensFor,
} from "@calendar/auth/google-tokens";
import {
  CalendarFailure,
  CalendarReadFailure,
  CalendarRef,
  CalendarStore,
  GoogleHttp,
  GoogleRetryPolicy,
  SyncResult,
} from "@calendar/calendar";
import {
  CalendarEvent,
  ListCalendarsOutput,
  ListEventsOutput,
  equivalenceKey,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { makeDevelopmentBackend } from "../../src/dev/backend.js";
import { fakeCalendarGoogle } from "../../src/dev/calendar-google.js";
import { seedFakePerson } from "../../src/dev/person.js";
import { createBackend } from "../../src/server/backend.js";
import { syncConnectedCalendars } from "../../src/server/calendar-cron.js";
import { calendarForPerson } from "../../src/server/calendar-runtime.js";
import { d1CalendarStore } from "../../src/server/calendar-store.js";
import { rpcDocument, rpcValue, rpcFailure } from "./calendar-rpc.js";
import { d1Fixture, seedCalendarCacheOwners } from "./d1-fixture.js";

it.effect(
  "development calendar RPC serves realistic ranges and persists edits",
  () =>
    Effect.gen(function* developmentCalendar() {
      const backend = makeDevelopmentBackend("http://calendar.test");
      const listed = yield* rpcDocument(backend, "listCalendars");

      const listing = (yield* Schema.decodeUnknownEffect(
        rpcValue(ListCalendarsOutput)
      )(listed))[0].exit.value;

      const accounts = listing.accounts.filter(
        (account) => "calendars" in account
      );

      expect(accounts).toHaveLength(2);
      const calendars = accounts.flatMap((account) => account.calendars);

      expect(calendars.length).toBeGreaterThanOrEqual(4);
      const now = DateTime.nowUnsafe();
      const start = DateTime.startOf(now, "week", { weekStartsOn: 1 });

      const range = {
        end: DateTime.formatIso(DateTime.add(start, { days: 14 })),
        start: DateTime.formatIso(start),
      };

      const refs = yield* Schema.decodeUnknownEffect(
        Schema.NonEmptyArray(CalendarRef)
      )(
        calendars.map(({ accountId, calendarId }) => ({
          accountId,
          calendarId,
        }))
      );

      const document = yield* rpcDocument(backend, "listEvents", {
        calendars: refs,
        range,
      });

      const snapshot = (yield* Schema.decodeUnknownEffect(
        rpcValue(ListEventsOutput)
      )(document))[0].exit.value;

      const copies = yield* Schema.decodeUnknownEffect(
        Schema.NonEmptyArray(CalendarEvent)
      )(snapshot.events.filter((event) => event.eventId === "overlap"));

      const lookalikes = yield* Schema.decodeUnknownEffect(
        Schema.NonEmptyArray(CalendarEvent)
      )(snapshot.events.filter((event) => event.eventId === "reviewlookalike"));

      const sharedKeys = copies.map(equivalenceKey);

      expect(copies).toHaveLength(2);
      expect(new Set(copies.map((event) => event.accountId)).size).toBe(2);
      expect(sharedKeys[0]).toBeDefined();
      expect(new Set(sharedKeys).size).toBe(1);
      expect(lookalikes).toHaveLength(1);
      expect(lookalikes[0].title).toBe(copies[0].title);
      expect(lookalikes[0].start).toEqual(copies[0].start);
      expect(lookalikes[0].end).toEqual(copies[0].end);
      expect(equivalenceKey(lookalikes[0])).toBeDefined();
      expect(equivalenceKey(lookalikes[0])).not.toBe(sharedKeys[0]);
      expect(
        snapshot.events.filter((event) => event.eventId === "accountonly")
      ).toHaveLength(1);
      expect(
        snapshot.events.every((event) => event.iCalUID !== undefined)
      ).toBe(true);

      const instances = snapshot.events.filter(
        (event) => event.recurringEventId === "series"
      );

      expect(new Set(instances.map((event) => event.iCalUID)).size).toBe(1);
      expect(
        instances.every((event) => equivalenceKey(event) !== undefined)
      ).toBe(true);
      expect(new Set(instances.map(equivalenceKey)).size).toBe(
        instances.length / 2
      );

      expect(
        snapshot.events.some((event) => event.status === "cancelled")
      ).toBe(false);
      expect(
        snapshot.events.some(
          (event) => event.start !== undefined && "date" in event.start
        )
      ).toBe(true);
      expect(
        snapshot.events.some((event) => event.recurringEventId !== undefined)
      ).toBe(true);
      expect(
        snapshot.events.some((event) => event.title === "Focus, moved later")
      ).toBe(true);
      expect(
        snapshot.events.some((event) => event.title === "Late release window")
      ).toBe(true);

      for (const status of ["declined", "tentative", "needsAction"]) {
        expect(
          snapshot.events.some(
            (event) =>
              event.attendees?.some(
                (attendee) => attendee.responseStatus === status
              ) === true
          )
        ).toBe(true);
      }

      const [ref] = refs;

      const createdDocument = yield* rpcDocument(backend, "createEvent", {
        ...ref,
        event: {
          end: {
            dateTime: DateTime.formatIso(DateTime.add(start, { hours: 1 })),
          },
          start: { dateTime: range.start },
          title: "New local event",
        },
        id: "abc123",
      });

      const created = (yield* Schema.decodeUnknownEffect(
        rpcValue(CalendarEvent)
      )(createdDocument))[0].exit.value;

      expect(created.title).toBe("New local event");

      const updatedDocument = yield* rpcDocument(backend, "updateEvent", {
        ...ref,
        changes: { title: "Edited local event" },
        eventId: created.eventId,
        scope: "single",
      });

      const updated = (yield* Schema.decodeUnknownEffect(
        rpcValue(CalendarEvent)
      )(updatedDocument))[0].exit.value;

      expect(updated.title).toBe("Edited local event");

      const refreshedDocument = yield* rpcDocument(backend, "listEvents", {
        calendars: [ref],
        range,
      });

      const refreshed = (yield* Schema.decodeUnknownEffect(
        rpcValue(ListEventsOutput)
      )(refreshedDocument))[0].exit.value;

      expect(
        refreshed.events.some(
          (event) =>
            event.eventId === created.eventId &&
            event.title === "Edited local event"
        )
      ).toBe(true);

      const refresh = yield* rpcDocument(backend, "syncNow", ref);

      const sync = (yield* Schema.decodeUnknownEffect(rpcValue(SyncResult))(
        refresh
      ))[0].exit.value;

      expect(sync.changed).toBeGreaterThan(0);

      const rsvpDocument = yield* rpcDocument(backend, "rsvp", {
        ...ref,
        eventId: "declined",
        response: "accepted",
      });

      const accepted = (yield* Schema.decodeUnknownEffect(
        rpcValue(CalendarEvent)
      )(rsvpDocument))[0].exit.value;

      expect(
        accepted.attendees?.find((attendee) => attendee.self === true)
          ?.responseStatus
      ).toBe("accepted");
      yield* rpcDocument(backend, "deleteEvent", {
        ...ref,
        eventId: created.eventId,
        scope: "single",
      });

      const afterDelete = yield* rpcDocument(backend, "listEvents", {
        calendars: [ref],
        range,
      });

      const remaining = (yield* Schema.decodeUnknownEffect(
        rpcValue(ListEventsOutput)
      )(afterDelete))[0].exit.value;

      expect(
        remaining.events.some((event) => event.eventId === created.eventId)
      ).toBe(false);
    })
);

const twoPeople = Effect.gen(function* twoPeople() {
  const fake = createFakeAuth("http://calendar.test");
  const first = yield* seedFakePerson(fake, ["joel@example.test"]);
  const second = yield* seedFakePerson(fake, ["second@example.test"]);

  const firstTokens = yield* googleTokensFor(
    fake.auth,
    first.personId,
    fake.config
  );

  const secondTokens = yield* googleTokensFor(
    fake.auth,
    second.personId,
    fake.config
  );

  const firstAccounts = yield* firstTokens
    .accounts()
    .pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.NonEmptyArray(ConnectedGoogleAccount))
      )
    );

  const secondAccounts = yield* secondTokens
    .accounts()
    .pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.NonEmptyArray(ConnectedGoogleAccount))
      )
    );

  const database = yield* d1Fixture;
  yield* seedCalendarCacheOwners(database, [first.personId, second.personId]);

  const googleHttp = yield* fakeCalendarGoogle([
    ...firstAccounts,
    ...secondAccounts,
  ]);

  const storeRequests: string[] = [];

  const options = {
    googleHttp,
    storeFor: (personId: string) => {
      storeRequests.push(personId);

      return d1CalendarStore(database, personId);
    },
  };

  return {
    database,
    fake,
    first,
    firstAccounts,
    options,
    second,
    secondAccounts,
    storeRequests,
  };
}).pipe(Effect.provide(FetchHttpClient.layer));

it.effect(
  "person runtime exposes the configured transport to channel operations",
  () =>
    Effect.gen(function* transportContext() {
      const fixture = yield* twoPeople;

      const expected = yield* GoogleHttp.pipe(
        Effect.provide(fixture.options.googleHttp)
      );

      const actual = yield* calendarForPerson(
        fixture.fake.auth,
        fixture.fake.config,
        fixture.first.personId,
        fixture.options,
        [],
        GoogleHttp
      );

      expect(actual).toBe(expected);

      yield* calendarForPerson(
        fixture.fake.auth,
        fixture.fake.config,
        fixture.first.personId,
        { storeFor: fixture.options.storeFor },
        [],
        GoogleHttp.pipe(Effect.asVoid)
      );
    })
);

it.effect(
  "RPC denies foreign accounts before cache or provider access for two signed-in people",
  () =>
    Effect.gen(function* ownershipIsolation() {
      const fixture = yield* twoPeople;
      const [foreign] = fixture.secondAccounts;

      const foreignRef = { accountId: foreign.id, calendarId: foreign.email };

      const foreignStore = yield* CalendarStore.pipe(
        Effect.provide(
          d1CalendarStore(fixture.database, fixture.second.personId)
        )
      );

      const range = {
        end: "2026-11-02T00:00:00Z",
        start: "2026-10-19T00:00:00Z",
      };

      yield* foreignStore.cacheRange(foreignRef, range, 0, []);

      const rpc = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createBackend(
            fixture.fake.auth,
            fixture.fake.config,
            new Headers({ cookie: fixture.first.cookie }),
            fixture.options
          )
        ),
        (backend) => Effect.promise(backend.dispose.bind(backend))
      );

      const document = yield* rpcDocument(rpc.handler, "getEvent", {
        ...foreignRef,
        eventId: "morning",
      });

      const failure = (yield* Schema.decodeUnknownEffect(
        rpcFailure(CalendarReadFailure)
      )(document))[0].exit.cause[0].error;

      expect(failure.cause._tag).toBe("NotConnected");

      const rangeDocument = yield* rpcDocument(rpc.handler, "listEvents", {
        calendars: [foreignRef],
        range,
      });

      const rangeFailure = (yield* Schema.decodeUnknownEffect(
        rpcFailure(CalendarReadFailure)
      )(rangeDocument))[0].exit.cause[0].error;

      expect(rangeFailure.cause._tag).toBe("NotConnected");
      expect(rangeFailure.accountId).toBe(foreign.id);
      expect(rangeFailure.calendarId).toBe(foreign.email);

      const writes: readonly (readonly [string, Schema.Json])[] = [
        ["syncNow", foreignRef],
        [
          "createEvent",
          {
            ...foreignRef,
            event: {
              end: { dateTime: range.end },
              start: { dateTime: range.start },
              title: "Forbidden",
            },
            id: "abc123",
          },
        ],
        [
          "updateEvent",
          {
            ...foreignRef,
            changes: { title: "Forbidden" },
            eventId: "morning",
            scope: "single",
          },
        ],
        ["deleteEvent", { ...foreignRef, eventId: "morning", scope: "single" }],
        ["rsvp", { ...foreignRef, eventId: "morning", response: "accepted" }],
      ];

      for (const [tag, payload] of writes) {
        const denied = yield* rpcDocument(rpc.handler, tag, payload);

        const deniedFailure = (yield* Schema.decodeUnknownEffect(
          rpcFailure(CalendarFailure)
        )(denied))[0].exit.cause[0].error;

        expect(deniedFailure._tag).toBe("NotConnected");
      }

      const [own] = fixture.firstAccounts;

      const secondRpc = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createBackend(
            fixture.fake.auth,
            fixture.fake.config,
            new Headers({ cookie: fixture.second.cookie }),
            fixture.options
          )
        ),
        (backend) => Effect.promise(backend.dispose.bind(backend))
      );

      const reverse = yield* rpcDocument(secondRpc.handler, "getEvent", {
        accountId: own.id,
        calendarId: own.email,
        eventId: "morning",
      });

      const reverseFailure = (yield* Schema.decodeUnknownEffect(
        rpcFailure(CalendarReadFailure)
      )(reverse))[0].exit.cause[0].error;

      expect(reverseFailure.cause._tag).toBe("NotConnected");
      expect(fixture.storeRequests).toEqual([]);
      expect((yield* foreignStore.read(foreignRef)).revision).toBe(0);
    })
);

it.effect(
  "cron synchronizes connected calendars through the same person-scoped services",
  () =>
    Effect.gen(function* cronSync() {
      const fixture = yield* twoPeople;

      const result = yield* syncConnectedCalendars(
        fixture.fake.auth,
        fixture.fake.config,
        fixture.options
      );

      expect(result).toEqual({ failed: 0, people: 2, synced: 4 });

      for (const [person, accounts] of [
        [fixture.first, fixture.firstAccounts],
        [fixture.second, fixture.secondAccounts],
      ] as const) {
        const [account] = accounts;

        const store = yield* CalendarStore.pipe(
          Effect.provide(d1CalendarStore(fixture.database, person.personId))
        );

        const snapshot = yield* store.read({
          accountId: account.id,
          calendarId: account.email,
        });

        expect(snapshot.cursor).toBeDefined();
        expect(snapshot.revision).toBe(1);
      }
    })
);

it.effect(
  "RPC preserves not-found, rate-limit and provider-down failure tags",
  () =>
    Effect.gen(function* errorMapping() {
      const fixture = yield* twoPeople;
      const [account] = fixture.firstAccounts;

      for (const [status, tag] of [
        [404, "NotFound"],
        [429, "RateLimited"],
        [503, "Provider"],
      ] as const) {
        const googleHttp = Layer.merge(
          Layer.succeed(GoogleHttp, {
            execute: () =>
              Effect.succeed({ body: "{}", retryAfterMs: 0, status }),
          }),
          Layer.succeed(GoogleRetryPolicy, { baseDelayMs: 0, retries: 0 })
        );

        const rpc = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createBackend(
              fixture.fake.auth,
              fixture.fake.config,
              new Headers({ cookie: fixture.first.cookie }),
              { ...fixture.options, googleHttp }
            )
          ),
          (backend) => Effect.promise(backend.dispose.bind(backend))
        );

        const document = yield* rpcDocument(rpc.handler, "getEvent", {
          accountId: account.id,
          calendarId: account.email,
          eventId: "missing",
        });

        const failure = (yield* Schema.decodeUnknownEffect(
          rpcFailure(CalendarReadFailure)
        )(document))[0].exit.cause[0].error;

        expect(failure.cause._tag).toBe(tag);
      }

      const context = yield* authContext(fixture.fake.auth);

      yield* Effect.promise(
        context.adapter.update.bind(context.adapter, {
          model: "account",
          update: { disconnected: true },
          where: [{ field: "id", value: account.id }],
        })
      );

      const rpc = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createBackend(
            fixture.fake.auth,
            fixture.fake.config,
            new Headers({ cookie: fixture.first.cookie }),
            fixture.options
          )
        ),
        (backend) => Effect.promise(backend.dispose.bind(backend))
      );

      const disconnected = yield* rpcDocument(rpc.handler, "getEvent", {
        accountId: account.id,
        calendarId: account.email,
        eventId: "morning",
      });

      const failure = (yield* Schema.decodeUnknownEffect(
        rpcFailure(CalendarReadFailure)
      )(disconnected))[0].exit.cause[0].error;

      expect(failure.cause._tag).toBe("Revoked");
    }),
  { timeout: 30_000 }
);
