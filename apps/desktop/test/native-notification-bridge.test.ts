import {
  NativeNotificationNotice,
  NativeNotificationRequest,
  nativeNotificationWire,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";

import { createDesktopBridge } from "../src/bridge-client.js";
import { nativeRef } from "./native-notifications-fixture.js";

interface NativeObserverFixture {
  receive: ((message: string) => void) | undefined;
}

// @effect-diagnostics-next-line asyncFunction:off -- This faithful unused native method must return the foreign Promise interface and reject if called.
const unexpectedNative = async (): Promise<never> =>
  await Promise.reject(new Error("Unexpected native method"));

it.effect(
  "the actual isolated bridge validates native requests replies and versioned observations without trusting extra URL fields",
  () =>
    Effect.gen(function* nativeBridge() {
      const messages: string[] = [];
      const notices: (typeof NativeNotificationNotice.Type)[] = [];
      const callbacks: NativeObserverFixture = { receive: undefined };

      let rejected = 0;

      const encodedReply = yield* Schema.encodeEffect(
        nativeNotificationWire.reply
      )({
        claims: [],
        ref: { ...nativeRef(), generation: 1 },
        status: "ready",
        version: 1,
      });

      const bridge = createDesktopBridge({
        getSettings: unexpectedNative,
        joinMeeting: unexpectedNative,
        // @effect-diagnostics-next-line asyncFunction:off -- This faithful preload port implements the foreign IPC Promise interface, not application async work.
        nativeNotifications: async (message) => {
          messages.push(message);

          return await Promise.resolve(encodedReply);
        },
        publishAgenda: () => {},
        rejected: () => {
          rejected += 1;
        },
        savePreferences: unexpectedNative,
        setStartup: unexpectedNative,
        subscribeActions: () => () => {},
        subscribeNativeNotifications: (listener) => {
          callbacks.receive = listener;

          return () => {
            callbacks.receive = undefined;
          };
        },
        subscribeSettings: () => () => {},
      });

      const request = bridge.nativeNotifications;
      const observe = bridge.onNativeNotification;

      if (request === undefined || observe === undefined) {
        return yield* Effect.die("Missing native bridge methods");
      }

      const result = yield* Effect.tryPromise(
        request.bind(
          bridge,
          NativeNotificationRequest.cases.Show.make({
            ref: nativeRef(),
            version: 1,
          })
        )
      );

      expect(result.ref?.generation).toBe(1);
      expect(
        yield* Schema.decodeEffect(nativeNotificationWire.request)(
          messages[0] ?? ""
        )
      ).toEqual(
        NativeNotificationRequest.cases.Show.make({
          ref: nativeRef(),
          version: 1,
        })
      );

      const forged = {
        ...NativeNotificationRequest.cases.Show.make({
          ref: nativeRef(),
          version: 1,
        }),
        href: "https://forged.example.test",
      };

      const failure = yield* Effect.tryPromise(
        request.bind(bridge, forged)
      ).pipe(Effect.result);

      expect(Result.isFailure(failure)).toBe(true);
      expect(messages).toHaveLength(1);

      const stop = observe((notice) => {
        notices.push(notice);
      });

      callbacks.receive?.(
        yield* Schema.encodeEffect(nativeNotificationWire.notice)({
          notice: NativeNotificationNotice.cases.Clicked.make({
            ref: nativeRef(),
          }),
          version: 1,
        })
      );
      callbacks.receive?.(
        JSON.stringify({
          notice: NativeNotificationNotice.cases.Clicked.make({
            ref: nativeRef(),
          }),
          version: 2,
        })
      );
      expect(notices).toMatchObject([{ ref: { key: nativeRef().key } }]);
      expect(notices.map((notice) => notice._tag)).toEqual(["Clicked"]);
      expect(rejected).toBe(1);
      stop();

      return yield* Effect.void;
    })
);
