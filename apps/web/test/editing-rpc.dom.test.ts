import type { GoogleRequestValue, GoogleResponse } from "@calendar/calendar";
import { Provider } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Exit, Queue, Ref, Schema, Scope } from "effect";
import { FetchHttpClient } from "effect/http";

import {
  ref,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { MutationFeatureUnavailable } from "../src/client/editing/failure.js";
import type { MutationFailureValue } from "../src/client/editing/failure.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";

const start = { dateTime: "2026-03-15T16:00:00Z" };

const end = { dateTime: "2026-03-15T17:00:00Z" };

const instance = timedEvent("instance", "Weekly meeting", {
  originalStartTime: start,
  recurringEventId: "series",
});

const master = timedEvent("series", "Weekly meeting", {
  end: {
    dateTime: "2026-03-01T10:00:00-08:00",
    timeZone: "America/Los_Angeles",
  },
  recurrence: ["RRULE:FREQ=WEEKLY"],
  start: {
    dateTime: "2026-03-01T09:00:00-08:00",
    timeZone: "America/Los_Angeles",
  },
});

interface Scenario {
  readonly inspect?: (writes: readonly GoogleRequestValue[]) => void;
  readonly methods: readonly GoogleRequestValue["method"][];
  readonly name: string;
  readonly responses: readonly GoogleResponse[];
  readonly run: Effect.Effect<
    void,
    MutationFailureValue,
    CalendarEditingClient
  >;
  readonly sendUpdates: "all" | "none";
}

const scenarios: readonly Scenario[] = [
  {
    inspect: (writes) => {
      expect(writeBody(writes[0]?.body)).toMatchObject({
        id: "0123456789abcdef",
        summary: "Created in fixture",
      });
    },
    methods: ["POST"],
    name: "create",
    responses: [
      response(200, timedEvent("0123456789abcdef", "Created in fixture")),
    ],
    run: CalendarEditingClient.use((client) =>
      client.createEvent({
        ...ref,
        event: { end, start, title: "Created in fixture" },
        id: "0123456789abcdef",
        sendUpdates: "none",
      })
    ).pipe(Effect.asVoid),
    sendUpdates: "none",
  },
  {
    inspect: (writes) => {
      expect(writeBody(writes[0]?.body)).toMatchObject({
        end: { dateTime: "2026-03-15T19:00:00Z" },
        start: { dateTime: "2026-03-15T18:00:00Z" },
      });
    },
    methods: ["PATCH"],
    name: "move a timed event",
    responses: [
      response(200, timedEvent("event")),
      response(
        200,
        timedEvent("event", "Moved", {
          end: { dateTime: "2026-03-15T19:00:00Z" },
          start: { dateTime: "2026-03-15T18:00:00Z" },
        })
      ),
    ],
    run: CalendarEditingClient.use((client) =>
      client.updateEvent({
        ...ref,
        changes: {
          end: { dateTime: "2026-03-15T19:00:00Z" },
          start: { dateTime: "2026-03-15T18:00:00Z" },
        },
        eventId: "event",
        scope: "single",
        sendUpdates: "none",
      })
    ).pipe(Effect.asVoid),
    sendUpdates: "none",
  },
  {
    inspect: (writes) => {
      expect(writeBody(writes[0]?.body)).toMatchObject({
        summary: "Only this instance",
      });
      expect(writes[0]?.path).toContain("/events/instance?");
    },
    methods: ["PATCH"],
    name: "edit one instance with an explicitly chosen email update",
    responses: [
      response(200, instance),
      response(200, { ...instance, summary: "Only this instance" }),
    ],
    run: CalendarEditingClient.use((client) =>
      client.updateEvent({
        ...ref,
        changes: { title: "Only this instance" },
        eventId: "instance",
        scope: "single",
        sendUpdates: "all",
      })
    ).pipe(Effect.asVoid),
    sendUpdates: "all",
  },
  {
    inspect: (writes) => {
      expect(writeBody(writes[0]?.body)).toMatchObject({
        summary: "Future meetings",
      });
      expect(writeBody(writes[1]?.body)).toMatchObject({
        recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20260315T155959Z"],
      });
    },
    methods: ["POST", "PATCH"],
    name: "edit this and following instances",
    responses: [
      response(200, instance),
      response(200, master),
      response(200, master),
      response(
        200,
        timedEvent("successor", "Future meetings", {
          recurrence: ["RRULE:FREQ=WEEKLY"],
        })
      ),
      response(200, master),
    ],
    run: CalendarEditingClient.use((client) =>
      client.updateEvent({
        ...ref,
        changes: { title: "Future meetings" },
        eventId: "instance",
        scope: "allFollowing",
        sendUpdates: "none",
      })
    ).pipe(Effect.asVoid),
    sendUpdates: "none",
  },
  {
    methods: ["DELETE"],
    name: "delete one instance",
    responses: [response(204)],
    run: CalendarEditingClient.use((client) =>
      client.deleteEvent({
        ...ref,
        eventId: "instance",
        scope: "single",
        sendUpdates: "none",
      })
    ),
    sendUpdates: "none",
  },
  {
    inspect: (writes) => {
      expect(writeBody(writes[0]?.body)).toMatchObject({
        attendees: [
          {
            comment: "Accepted in fixture",
            email: "owner@example.test",
            responseStatus: "accepted",
            self: true,
          },
        ],
        attendeesOmitted: true,
      });
    },
    methods: ["PATCH"],
    name: "RSVP with an optional note",
    responses: [
      response(
        200,
        timedEvent("invited", "Invitation", {
          attendees: [
            {
              email: "owner@example.test",
              responseStatus: "needsAction",
              self: true,
            },
            { email: "other@example.test", responseStatus: "accepted" },
          ],
          organizer: { email: "host@example.test", self: false },
        })
      ),
      response(200, timedEvent("invited", "Invitation")),
    ],
    run: CalendarEditingClient.use((client) =>
      client.rsvp({
        ...ref,
        eventId: "invited",
        note: "Accepted in fixture",
        response: "accepted",
        sendUpdates: "none",
      })
    ).pipe(Effect.asVoid),
    sendUpdates: "none",
  },
  {
    inspect: (writes) => {
      expect(writes[0]?.path).toContain("/events/event/move?");
      expect(
        new URL(
          writes[0]?.path ?? "",
          "https://fixture.invalid"
        ).searchParams.get("destination")
      ).toBe("destination");
    },
    methods: ["POST"],
    name: "move to another calendar in the same account",
    responses: [
      response(200, timedEvent("event")),
      response(200, timedEvent("event")),
    ],
    run: CalendarEditingClient.use((client) =>
      client.moveEvent({
        ...ref,
        destination: { accountId: ref.accountId, calendarId: "destination" },
        eventId: "event",
        sendUpdates: "none",
      })
    ).pipe(
      Effect.tap((event) =>
        Effect.sync(() => {
          expect(event.calendarId).toBe("destination");
        })
      ),
      Effect.asVoid
    ),
    sendUpdates: "none",
  },
];

it.effect.each(scenarios)("browser RPC: $name", (scenario) =>
  Effect.gen(function* calendarWriteRpc() {
    const api = yield* editingRpcFixture(scenario.responses);
    yield* scenario.run.pipe(
      Effect.provide(CalendarEditingClient.layer("available")),
      Effect.provideService(FetchHttpClient.Fetch, api.fetcher)
    );
    const requests = yield* Ref.get(api.fake.requests);
    const writes = requests.filter((request) => request.method !== "GET");
    expect(writes.map((request) => request.method)).toEqual(scenario.methods);

    for (const request of writes) {
      expect(
        new URL(request.path, "https://fixture.invalid").searchParams.get(
          "sendUpdates"
        )
      ).toBe(scenario.sendUpdates);
    }

    scenario.inspect?.(writes);
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.keepalive).toBe(false);
  })
);

it.effect(
  "the pagehide delete reaches the normal RPC handler as a native keepalive request",
  () =>
    Effect.gen(function* keepaliveRpc() {
      const api = yield* editingRpcFixture([response(204)]);
      yield* CalendarEditingClient.use((client) =>
        client.deleteEvent(
          { ...ref, eventId: "instance", scope: "single", sendUpdates: "none" },
          true
        )
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher)
      );
      expect(api.requests).toHaveLength(1);
      expect(api.requests[0]?.keepalive).toBe(true);
      expect((yield* Ref.get(api.fake.requests))[0]?.method).toBe("DELETE");
    })
);

it.effect(
  "unavailable calendar movement fails before any request to a missing handler",
  () =>
    Effect.gen(function* unavailableMove() {
      const api = yield* editingRpcFixture([]);

      const failure = yield* CalendarEditingClient.use((client) =>
        client.moveEvent({
          ...ref,
          destination: { accountId: ref.accountId, calendarId: "destination" },
          eventId: "event",
          sendUpdates: "none",
        })
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher),
        Effect.flip
      );

      expect(Schema.is(MutationFeatureUnavailable)(failure)).toBe(true);
      expect(api.requests).toHaveLength(0);
      expect(yield* Ref.get(api.fake.requests)).toHaveLength(0);
    })
);

it.effect(
  "a typed provider refusal survives the browser RPC boundary for optimistic rollback",
  () =>
    Effect.gen(function* typedWriteFailure() {
      const api = yield* editingRpcFixture([
        response(400, { error: { message: "Fixture rejected" } }),
      ]);

      const failure = yield* CalendarEditingClient.use((client) =>
        client.createEvent({
          ...ref,
          event: { end, start, title: "Rejected event" },
          id: "0123456789abcdef",
          sendUpdates: "none",
        })
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher),
        Effect.flip
      );

      const provider = yield* Schema.decodeUnknownEffect(Provider)(failure);
      expect(provider.status).toBe(400);
      expect(api.requests).toHaveLength(1);
    })
);

it.effect.each([false, true])(
  "native keepalive survives client scope shutdown: %s",
  (keepalive) =>
    Effect.gen(function* nativeKeepaliveScope() {
      const api = yield* editingRpcFixture([response(204)]);
      const ready = yield* Queue.unbounded<boolean>();
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let cancelled = false;
      let bytes = new Uint8Array();

      const paused = new ReadableStream<Uint8Array>(
        {
          cancel: () => {
            cancelled = true;
          },
          pull: (current) => {
            controller = current;
            Queue.offerUnsafe(ready, true);
          },
        },
        { highWaterMark: 0 }
      );

      // @effect-diagnostics-next-line asyncFunction:off -- Native Fetch requires a Promise-returning adapter around the paused RPC response.
      const fetcher: typeof fetch = async (input, init) => {
        const reply = await api.fetcher(input, init);
        bytes = new Uint8Array(await reply.arrayBuffer());

        return new Response(paused, {
          headers: reply.headers,
          status: reply.status,
        });
      };

      const scope = yield* Effect.acquireRelease(Scope.make(), (current) =>
        Scope.close(current, Exit.void)
      );

      yield* CalendarEditingClient.use((client) =>
        client.deleteEvent(
          { ...ref, eventId: "instance", scope: "single", sendUpdates: "none" },
          keepalive
        )
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, fetcher),
        Effect.forkIn(scope)
      );
      yield* Queue.take(ready);
      yield* Scope.close(scope, Exit.void);
      const aborted = api.requests[0]?.signal.aborted;
      const bodyCancelled = cancelled;

      if (controller !== undefined && !cancelled) {
        controller.enqueue(bytes);
        controller.close();
      }

      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(api.requests[0]?.keepalive).toBe(keepalive);

      if (keepalive) {
        expect(aborted).toBe(false);
        expect(bodyCancelled).toBe(false);
      } else {
        expect(aborted).toBe(true);
      }
    })
);
