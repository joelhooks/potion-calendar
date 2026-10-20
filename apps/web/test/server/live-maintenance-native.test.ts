import { expect, it } from "@effect/vitest";
import { Cause, Effect, Option, Schema } from "effect";

import { makeNativeDevelopmentRuntime } from "../../src/dev/native-runtime.js";
import type { CalendarEnvironment } from "../../src/server/calendar-environment.js";
import { LiveCommand } from "../../src/server/live-protocol.js";
import { nativeLiveCommand } from "./native-live-command.js";

it.live(
  "native no-op inventory runs and hibernation publish no extra calendar-list notices",
  () =>
    Effect.gen(function* nativeMaintenance() {
      const origin = "http://127.0.0.1:5173";

      const runtime = yield* makeNativeDevelopmentRuntime(origin);

      const bindings = yield* Effect.tryPromise({
        catch: (cause) => new Cause.UnknownError(cause),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => runtime.miniflare.getBindings<CalendarEnvironment>(),
      });

      const response = yield* Effect.tryPromise({
        catch: (cause) => new Cause.UnknownError(cause),
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

      const socket = yield* Effect.fromNullishOr(response.webSocket).pipe(
        Effect.orDie
      );

      const notices: string[] = [];
      socket.addEventListener("message", (event) => {
        const frame = Schema.decodeUnknownOption(
          Schema.fromJsonString(Schema.TaggedStruct("CalendarListChanged", {}))
        )(event.data);

        if (Option.isSome(frame)) {
          notices.push(frame.value._tag);
        }
      });

      socket.accept();

      const barrier = () =>
        Effect.callback<boolean>((resume) => {
          const receive = (event: { readonly data: unknown }) => {
            if (event.data === "pong") {
              resume(Effect.succeed(true));
            }
          };

          socket.addEventListener("message", receive);
          socket.send("ping");

          return Effect.sync(() => {
            socket.removeEventListener("message", receive);
          });
        });

      const reconcile = () =>
        nativeLiveCommand(
          bindings.CALENDAR_LIVE,
          LiveCommand.cases.Reconcile.make({
            personId: runtime.person.personId,
          })
        );

      yield* reconcile();
      yield* barrier();
      expect(notices).toHaveLength(1);
      yield* reconcile();
      yield* barrier();
      expect(notices).toHaveLength(1);
      yield* Effect.tryPromise({
        catch: (cause) => new Cause.UnknownError(cause),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          runtime.miniflare.unsafeEvictDurableObject(
            "calendar-development",
            "CalendarLive",
            { name: runtime.person.personId, webSockets: "hibernate" }
          ),
      });
      yield* reconcile();
      yield* barrier();
      expect(notices).toHaveLength(1);

      socket.close();
    })
);
