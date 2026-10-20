import type { Calendar } from "@calendar/calendar/contracts";
import {
  CalendarFailure,
  ListCalendarsOutput,
} from "@calendar/calendar/contracts";
import { accountDisconnectRepository } from "@calendar/database/account-disconnect";
import { Cause, Effect, Queue, Schema } from "effect";

import { LiveFrame } from "../../src/client/live/protocol.js";
import type { LiveFrameValue } from "../../src/client/live/protocol.js";
import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import type { CalendarEnvironment } from "../../src/server/calendar-environment.js";
import { rpcDocument, rpcFailure, rpcValue } from "./calendar-rpc.js";
import { nativeLiveClient } from "./native-live-command.js";

const Counts = Schema.Struct({
  accounts: Schema.Int,
  channels: Schema.Int,
  ranges: Schema.Int,
  snapshots: Schema.Int,
});

export const settingsRpcFixture = Effect.gen(function* settingsRpcFixture() {
  const runtime = yield* DevelopmentRuntime;
  const { origin } = runtime;
  const headers = new Headers({ cookie: runtime.person.cookie, origin });

  // @effect-diagnostics-next-line asyncFunction:off -- The RPC harness forwards native Web Requests to the actual development entrypoint.
  const backend = async (request: Request) =>
    await runtime.handle(
      new Request(`${origin}${new URL(request.url).pathname}`, request)
    );

  const success = <A>(
    method: string,
    input: Schema.Json,
    schema: Schema.Codec<A>,
    requestHeaders = headers
  ) =>
    rpcDocument(backend, method, input, requestHeaders).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(schema))),
      Effect.map((document) => document[0].exit.value)
    );

  const failure = <A>(
    method: string,
    input: Schema.Json,
    schema: Schema.Codec<A>
  ) =>
    rpcDocument(backend, method, input, headers).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(rpcFailure(schema))),
      Effect.map((document) => document[0].exit.cause[0].error)
    );

  const execute = (sql: string, ...values: (string | number | null)[]) =>
    Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(cause, "Settings fixture statement failed"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        runtime.database
          .prepare(sql)
          .bind(...values)
          .run(),
    });

  const counts = (accountId: string) =>
    Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(cause, "Settings fixture row counts failed"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        runtime.database
          .prepare(`SELECT
      (SELECT count(*) FROM account WHERE userId = ? AND id = ?) AS accounts,
      (SELECT count(*) FROM calendar_snapshot WHERE person_id = ? AND account_id = ?) AS snapshots,
      (SELECT count(*) FROM calendar_range WHERE person_id = ? AND account_id = ?) AS ranges,
      (SELECT count(*) FROM google_push_channel WHERE person_id = ? AND account_id = ?) AS channels`)
          .bind(
            runtime.person.personId,
            accountId,
            runtime.person.personId,
            accountId,
            runtime.person.personId,
            accountId,
            runtime.person.personId,
            accountId
          )
          .first(),
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Counts)));

  const listing = yield* success("listCalendars", {}, ListCalendarsOutput);
  const calendars: (typeof Calendar.Type)[] = [];

  for (const account of listing.accounts) {
    if ("calendars" in account) {
      calendars.push(...account.calendars);
    }
  }

  const [target] = calendars;

  if (target === undefined) {
    return yield* Effect.die(new Error("Settings fixture has no calendar"));
  }

  const bindings = yield* Effect.tryPromise({
    catch: (cause) =>
      new Cause.UnknownError(cause, "Settings fixture bindings failed"),
    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
    try: () => runtime.miniflare.getBindings<CalendarEnvironment>(),
  }).pipe(Effect.orDie);

  const live = nativeLiveClient(bindings.CALENDAR_LIVE);

  const receipt = accountDisconnectRepository(
    runtime.database,
    runtime.person.personId
  ).load;

  const providerFailure = (input: Schema.Json) =>
    failure("setCalendarAppearance", input, CalendarFailure);

  const openFrames = Effect.gen(function* openSettingsFrames() {
    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(cause, "Settings socket upgrade failed"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        runtime.miniflare.dispatchFetch(`${origin}/live`, {
          headers: {
            cookie: runtime.person.cookie,
            origin,
            upgrade: "websocket",
          },
        }),
    });

    const socket = response.webSocket;

    if (socket === null) {
      return yield* Effect.die(new Error("Missing settings socket"));
    }

    const frames = yield* Queue.bounded<unknown>(16);
    socket.accept();
    socket.addEventListener("message", (event) => {
      Queue.offerUnsafe(frames, event.data);
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        socket.close();
      })
    );

    const next = Queue.take(frames).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.fromJsonString(LiveFrame))
      ),
      Effect.timeout(1000)
    );

    yield* live.reconcile(runtime.person.personId);

    const barrier = Effect.fn("test.settingsFrameBarrier")(function* barrier(
      version: number
    ) {
      const seen: LiveFrameValue[] = [];
      yield* live.publish(runtime.person.personId, {
        accountId: target.accountId,
        calendarId: target.calendarId,
        reason: "reset",
        version,
      });

      while (true) {
        const frame = yield* next;

        if (
          Schema.is(LiveFrame.members[0])(frame) &&
          frame.version === version
        ) {
          return seen;
        }

        seen.push(frame);
      }
    });

    yield* barrier(1_000_001);

    return { barrier, next };
  });

  return {
    backend,
    bindings,
    calendars,
    counts,
    execute,
    failure,
    headers,
    live,
    openFrames,
    origin,
    providerFailure,
    receipt,
    runtime,
    success,
    target,
  };
});
