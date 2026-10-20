import { CalendarChanged } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Option, Queue, Schema } from "effect";

import { makeNativeDevelopmentRuntime } from "../../src/dev/native-runtime.js";
import type { CalendarEnvironment } from "../../src/server/calendar-environment.js";
import { LiveCommand } from "../../src/server/live-protocol.js";
import { nativeLiveClient, nativeLiveCommand } from "./native-live-command.js";

const receive =
  (queue: Queue.Queue<typeof CalendarChanged.Type>) =>
  (event: { readonly data: unknown }) => {
    const decoded = Schema.decodeUnknownOption(
      Schema.fromJsonString(CalendarChanged)
    )(event.data);

    if (Option.isSome(decoded)) {
      Queue.offerUnsafe(queue, decoded.value);
    }
  };

it.live(
  "hibernated sockets retain their person attachment and never receive another person's publications",
  () =>
    Effect.gen(function* nativeSocketIsolation() {
      const origin = "http://127.0.0.1:5173";

      const runtime = yield* makeNativeDevelopmentRuntime(origin, [
        "joel@example.test",
      ]);

      const other = yield* runtime.seedPerson(["second@example.test"]);
      expect(other.personId).not.toBe(runtime.person.personId);

      const bindings = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native binding fixture failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => runtime.miniflare.getBindings<CalendarEnvironment>(),
      });

      const live = nativeLiveClient(bindings.CALENDAR_LIVE);

      const connect = (cookie: string) =>
        Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Native socket fixture failed"),

          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () =>
            runtime.miniflare.dispatchFetch(`${origin}/live`, {
              headers: { cookie, origin, upgrade: "websocket" },
            }),
        }).pipe(
          Effect.map((response) => {
            expect(response.status).toBe(101);

            if (response.webSocket === null) {
              throw new Error("Missing fixture socket");
            }

            response.webSocket.accept();

            return response.webSocket;
          })
        );

      const a = yield* connect(runtime.person.cookie);
      const b = yield* connect(other.cookie);
      const noticesA = yield* Queue.unbounded<typeof CalendarChanged.Type>();
      const noticesB = yield* Queue.unbounded<typeof CalendarChanged.Type>();

      a.addEventListener("message", receive(noticesA));
      b.addEventListener("message", receive(noticesB));
      yield* nativeLiveCommand(
        bindings.CALENDAR_LIVE,
        LiveCommand.cases.Reconcile.make({ personId: runtime.person.personId })
      );
      yield* nativeLiveCommand(
        bindings.CALENDAR_LIVE,
        LiveCommand.cases.Reconcile.make({ personId: other.personId })
      );
      yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Native hibernation fixture failed"),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          runtime.miniflare.unsafeEvictDurableObject(
            "calendar-development",
            "CalendarLive",
            { name: runtime.person.personId, webSockets: "hibernate" }
          ),
      });

      const changed = CalendarChanged.make({
        accountId: "scope-only-account",
        calendarId: "scope-only-calendar",
        reason: "write",
        version: 3,
      });

      yield* live.publish(other.personId, changed);
      expect(yield* Queue.take(noticesB)).toEqual(changed);
      expect(yield* Queue.size(noticesA)).toBe(0);
      yield* live.publish(runtime.person.personId, changed);
      expect(yield* Queue.take(noticesA)).toEqual(changed);
      expect(yield* Queue.size(noticesB)).toBe(0);
      a.close();
      b.close();
    })
);
