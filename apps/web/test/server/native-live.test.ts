import {
  CalendarEvent,
  CalendarFailure,
  DisconnectAccountFailure,
  DisconnectAccountResult,
  ListCalendarsOutput,
  ListEventsOutput,
} from "@calendar/calendar/contracts";
import { SessionSnapshot } from "@calendar/core/contracts";
import { googlePushRepository } from "@calendar/database/google-push";
import { expect, it } from "@effect/vitest";
import { Cause, Clock, DateTime, Effect, Fiber, Option, Schema } from "effect";

import { makeNativeDevelopmentRuntime } from "../../src/dev/native-runtime.js";
import type { CalendarEnvironment } from "../../src/server/calendar-environment.js";
import { LiveCommand } from "../../src/server/live-protocol.js";
import { rpcDocument, rpcFailure, rpcValue } from "./calendar-rpc.js";
import { nativeLiveClient, nativeLiveCommand } from "./native-live-command.js";

it.live(
  "the native D1/DO Worker authenticates sockets and turns a simulated Google notification into a committed invalidation",
  () =>
    Effect.gen(function* nativePushRoundTrip() {
      const origin = "http://127.0.0.1:5173";
      const runtime = yield* makeNativeDevelopmentRuntime(origin);
      const headers = new Headers({ cookie: runtime.person.cookie, origin });

      // @effect-diagnostics-next-line asyncFunction:off -- The RPC harness forwards Web Requests to the actual development entrypoint.
      const backend = async (request: Request) =>
        await runtime.handle(
          new Request(`${origin}${new URL(request.url).pathname}`, request)
        );

      const session = yield* Schema.decodeUnknownEffect(
        rpcValue(SessionSnapshot)
      )(yield* rpcDocument(backend, "session", {}, headers));

      expect(session[0].exit.value?.accounts).toHaveLength(2);

      const listing = yield* Schema.decodeUnknownEffect(
        rpcValue(ListCalendarsOutput)
      )(yield* rpcDocument(backend, "listCalendars", {}, headers));

      const [account] = listing[0].exit.value.accounts;

      if (account === undefined || !("calendars" in account)) {
        throw new Error("Missing native calendars");
      }

      const [calendar] = account.calendars;

      if (calendar === undefined) {
        throw new Error("Missing native calendar");
      }

      const bindings = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => runtime.miniflare.getBindings<CalendarEnvironment>(),
      }).pipe(Effect.orDie);

      const live = nativeLiveClient(bindings.CALENDAR_LIVE);
      yield* nativeLiveCommand(
        bindings.CALENDAR_LIVE,
        LiveCommand.cases.Reconcile.make({ personId: runtime.person.personId })
      );

      const start = DateTime.startOf(yield* DateTime.now, "week", {
        weekStartsOn: 1,
      });

      const rangeInput = {
        calendars: [
          { accountId: account.accountId, calendarId: calendar.calendarId },
        ],
        range: {
          end: DateTime.formatIso(DateTime.add(start, { days: 14 })),
          start: DateTime.formatIso(start),
        },
      };

      const before = yield* Schema.decodeUnknownEffect(
        rpcValue(ListEventsOutput)
      )(yield* rpcDocument(backend, "listEvents", rangeInput, headers));

      expect(
        before[0].exit.value.events.find((event) => event.eventId === "overlap")
          ?.title
      ).toBe("Design review");

      const rows = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          runtime.database
            .prepare(
              "SELECT id, state, resource_id AS resourceId, token_hash AS tokenHash FROM google_push_channel WHERE state = 'active'"
            )
            .all(),
      }).pipe(Effect.orDie);

      expect(rows.results).toHaveLength(6);

      const first = yield* Schema.decodeUnknownEffect(
        Schema.NonEmptyArray(Schema.Struct({ id: Schema.String }))
      )(rows.results);

      expect(
        yield* googlePushRepository(runtime.database).delivery(
          first[0].id,
          yield* Clock.currentTimeMillis
        )
      ).not.toBeNull();
      expect(JSON.stringify(rows.results)).not.toContain("local-only");

      const socketResponse = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          runtime.miniflare.dispatchFetch(`${origin}/live`, {
            headers: {
              cookie: runtime.person.cookie,
              origin,
              upgrade: "websocket",
            },
          }),
      }).pipe(Effect.orDie);

      expect(socketResponse.status).toBe(101);
      const socket = socketResponse.webSocket;

      if (socket === null) {
        throw new Error("Missing native websocket");
      }

      socket.accept();

      const notice = Effect.callback<unknown>((resume) => {
        const receive = (event: { readonly data: unknown }) => {
          const parsed = Schema.decodeUnknownOption(
            Schema.fromJsonString(
              Schema.Struct({
                accountId: Schema.String,
                calendarId: Schema.String,
                reason: Schema.String,
                version: Schema.Finite,
              })
            )
          )(event.data);

          if (
            Option.isSome(parsed) &&
            parsed.value.accountId === account.accountId &&
            parsed.value.calendarId === calendar.calendarId
          ) {
            resume(Effect.succeed(parsed.value));
          }
        };

        socket.addEventListener("message", receive);

        return Effect.sync(() => {
          socket.removeEventListener("message", receive);
        });
      });

      const waiting = yield* Effect.forkChild(notice);

      const change = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          runtime.handle(
            new Request(`${origin}/__fake-google/change`, {
              body: JSON.stringify({
                calendarId: calendar.calendarId,
                email: "joel@example.test",
                eventId: "overlap",
                summary: "Changed outside Calendar",
              }),
              headers: { "content-type": "application/json" },
              method: "POST",
            })
          ),
      }).pipe(Effect.orDie);

      expect(change.status).toBe(200);
      expect(yield* Effect.promise(change.json.bind(change))).toEqual({
        delivered: 1,
        statuses: [200],
      });
      const observed = yield* Fiber.join(waiting);
      expect(observed).toMatchObject({
        accountId: account.accountId,
        calendarId: calendar.calendarId,
        reason: "sync",
      });

      const refreshed = yield* Schema.decodeUnknownEffect(
        rpcValue(ListEventsOutput)
      )(yield* rpcDocument(backend, "listEvents", rangeInput, headers));

      expect(
        refreshed[0].exit.value.events.find(
          (event) => event.eventId === "overlap"
        )?.title
      ).toBe("Changed outside Calendar");
      socket.close();

      const tracked = yield* googlePushRepository(runtime.database).active(
        runtime.person.personId,
        {
          accountId: account.accountId,
          calendarId: calendar.calendarId,
          kind: "events",
        }
      );

      if (tracked === undefined) {
        throw new Error("Missing native event watch");
      }

      const delivery = yield* googlePushRepository(runtime.database).delivery(
        tracked.id,
        yield* Clock.currentTimeMillis
      );

      if (delivery === null) {
        throw new Error("Missing native event delivery");
      }

      yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native owner eviction failed"),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          runtime.miniflare.unsafeEvictDurableObject(
            "calendar-development",
            "CalendarLive",
            { name: runtime.person.personId, webSockets: "hibernate" }
          ),
      });
      expect(yield* live.enqueue(delivery, "2", false)).toBe(false);
      expect(yield* live.enqueue(delivery, "1", false)).toBe(false);

      const [, target] = account.calendars;

      if (target === undefined) {
        throw new Error("Missing move destination");
      }

      const readVersion = (calendarId: string) =>
        Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Native Promise adapter failed"),

          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () =>
            runtime.database
              .prepare(
                "SELECT version FROM calendar_snapshot WHERE person_id = ? AND account_id = ? AND calendar_id = ?"
              )
              .bind(runtime.person.personId, account.accountId, calendarId)
              .first(),
        }).pipe(
          Effect.orDie,
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.NullOr(Schema.Struct({ version: Schema.Int }))
            )
          ),
          Effect.map((row) => row?.version ?? 0)
        );

      const beforeSource = yield* readVersion(calendar.calendarId);
      const beforeTarget = yield* readVersion(target.calendarId);

      const moved = yield* Schema.decodeUnknownEffect(rpcValue(CalendarEvent))(
        yield* rpcDocument(
          backend,
          "moveEvent",
          {
            accountId: account.accountId,
            calendarId: calendar.calendarId,
            destination: {
              accountId: account.accountId,
              calendarId: target.calendarId,
            },
            eventId: "overlap",
          },
          headers
        )
      );

      expect(moved[0].exit.value.calendarId).toBe(target.calendarId);
      expect(yield* readVersion(calendar.calendarId)).toBe(beforeSource + 1);
      expect(yield* readVersion(target.calendarId)).toBe(beforeTarget + 1);
      const [, other] = listing[0].exit.value.accounts;

      if (
        other === undefined ||
        !("calendars" in other) ||
        other.calendars[0] === undefined
      ) {
        throw new Error("Missing other account");
      }

      const refusedMove = yield* Schema.decodeUnknownEffect(
        rpcFailure(CalendarFailure)
      )(
        yield* rpcDocument(
          backend,
          "moveEvent",
          {
            accountId: account.accountId,
            calendarId: target.calendarId,
            destination: {
              accountId: other.accountId,
              calendarId: other.calendars[0].calendarId,
            },
            eventId: "overlap",
          },
          headers
        )
      );

      expect(refusedMove[0].exit.cause[0].error._tag).toBe("CrossAccountMove");

      const rejected = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native Promise adapter failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          runtime.miniflare.dispatchFetch(`${origin}/live`, {
            headers: {
              cookie: runtime.person.cookie,
              origin: "http://evil.localhost",
              upgrade: "websocket",
            },
          }),
      }).pipe(Effect.orDie);

      expect(rejected.status).toBe(403);

      const execute = (sql: string) =>
        Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Native fixture statement failed"),

          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => runtime.database.prepare(sql).run(),
        });

      const activeCount = Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native fixture query failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          runtime.database
            .prepare(
              "SELECT count(*) AS count FROM google_push_channel WHERE state = 'active'"
            )
            .first(),
      }).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.Struct({ count: Schema.Int }))
        ),
        Effect.map((row) => row.count)
      );

      const secondAccount = listing[0].exit.value.accounts.find(
        (candidate) =>
          "calendars" in candidate &&
          candidate.calendars.some(
            (entry) => entry.calendarId === "second@example.test"
          )
      );

      if (secondAccount === undefined) {
        throw new Error("Missing second account");
      }

      const disconnect = rpcDocument(
        backend,
        "disconnectAccount",
        { accountId: secondAccount.accountId },
        headers
      );

      yield* execute(
        "CREATE TRIGGER fixture_refuse_unlink BEFORE DELETE ON account WHEN OLD.accountId = 'second@example.test' BEGIN SELECT RAISE(FAIL, 'fixture-delete-refusal'); END"
      );

      const failed = yield* Schema.decodeUnknownEffect(
        rpcFailure(DisconnectAccountFailure)
      )(yield* disconnect);

      expect(failed[0].exit.cause[0].error._tag).toBe("Provider");
      expect(yield* activeCount).toBe(3);
      yield* live.reconcile(runtime.person.personId);
      expect(yield* activeCount).toBe(3);
      yield* execute("DROP TRIGGER fixture_refuse_unlink");

      const disconnected = yield* Schema.decodeUnknownEffect(
        rpcValue(DisconnectAccountResult)
      )(yield* disconnect);

      expect(disconnected[0].exit.value.revocation).toBe("notAttempted");
      expect(yield* activeCount).toBe(3);
      expect(
        runtime.outboundRequests.filter((request) => request.path === "/revoke")
      ).toHaveLength(0);
    })
);
