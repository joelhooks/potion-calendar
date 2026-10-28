// oxlint-disable typescript/promise-function-async -- Faithful isolated Promise fakes return native receipts without a second Effect runtime.
import {
  AboutReply,
  AboutRequest,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Function, Queue, Schema, Stream } from "effect";

import { createDesktopBridge } from "../src/bridge-client.js";
import type { RendererBridgePort } from "../src/bridge-client.js";
import { requestNativeAbout } from "../src/native-about.js";

const legacyPort = (): RendererBridgePort => ({
  getSettings: () =>
    Promise.resolve(
      JSON.stringify({
        issues: [],
        openAtLogin: false,
        preferences: defaultDesktopPreferences(),
        revision: 1,
      })
    ),
  joinMeeting: () => Promise.resolve("invalid"),
  publishAgenda: Function.constVoid,
  rejected: Function.constVoid,
  savePreferences: () => Promise.resolve("invalid"),
  setStartup: () => Promise.resolve("invalid"),
  subscribeActions: () => Function.constVoid,
  subscribeSettings: () => Function.constVoid,
});

it.effect(
  "old isolated bridges remain frozen and usable without an About method",
  () =>
    Effect.gen(function* legacyAbout() {
      const bridge = createDesktopBridge(legacyPort());
      expect(bridge.showAbout).toBeUndefined();
      expect(Object.isFrozen(bridge)).toBe(true);
      expect((yield* Effect.promise(() => bridge.getSettings())).revision).toBe(
        1
      );
    })
);

it.effect(
  "the isolated About codec reaches the native Effect once and rejects caller metadata before IPC",
  () =>
    Effect.gen(function* aboutRoundTrip() {
      const pending = yield* Queue.unbounded<{
        readonly message: string;
        readonly resolve: (reply: string) => void;
      }>();

      const calls: string[] = [];
      const frame = { url: "https://calendar.example.test/week" };
      const contents = { mainFrame: frame };
      const scope = yield* Effect.scope;
      yield* Stream.fromQueue(pending).pipe(
        Stream.runForEach(({ message, resolve }) =>
          requestNativeAbout(
            message,
            { sender: contents, senderFrame: frame },
            { isDestroyed: () => false, webContents: contents },
            "https://calendar.example.test",
            {
              platform: Effect.succeed("darwin"),
              request: Effect.sync(() => {
                calls.push("showAboutPanel");
              }),
            }
          ).pipe(
            Effect.tap((reply) =>
              Effect.sync(() => {
                resolve(reply);
              })
            )
          )
        ),
        Effect.forkIn(scope)
      );
      yield* Effect.addFinalizer(() => Queue.shutdown(pending));

      const bridge = createDesktopBridge({
        ...legacyPort(),
        // oxlint-disable promise/avoid-new -- The native Promise boundary is driven by the existing scoped Effect test queue, not another runtime.
        showAbout: (message) =>
          // @effect-diagnostics-next-line newPromise:off -- A controlled preload Promise supplies the actual encoded main-handler receipt.
          new Promise<string>((resolve) => {
            Queue.offerUnsafe(pending, { message, resolve });
          }),
        // oxlint-enable promise/avoid-new -- The controlled native Promise adapter ends here.
      });

      const { showAbout } = bridge;
      expect(showAbout).toBeDefined();

      if (showAbout === undefined) {
        return;
      }

      const reply = yield* Effect.promise(() =>
        showAbout(AboutRequest.make({ version: 1 }))
      );

      expect(reply).toEqual(AboutReply.cases.Requested.make({ version: 1 }));
      expect(calls).toEqual(["showAboutPanel"]);

      const forged = {
        ...AboutRequest.make({ version: 1 }),
        metadata: "Renderer-controlled title",
      };

      const refused = yield* Effect.tryPromise({
        catch: String,
        try: () => showAbout(forged),
      }).pipe(Effect.flip);

      expect(refused).toContain("Invalid About request");
      expect(calls).toEqual(["showAboutPanel"]);
    })
);

it.effect.prop(
  "the bridge rejects malformed or widened About replies",
  { text: Schema.String },
  ({ text }) =>
    Effect.gen(function* invalidReply() {
      for (const message of [
        '{"_tag":"Visible","version":1}',
        JSON.stringify({
          ...AboutReply.cases.Requested.make({ version: 1 }),
          metadata: text,
        }),
      ]) {
        const bridge = createDesktopBridge({
          ...legacyPort(),
          showAbout: () => Promise.resolve(message),
        });

        if (bridge.showAbout === undefined) {
          return;
        }

        const invoke = bridge.showAbout;

        const error = yield* Effect.tryPromise({
          catch: String,
          try: () => invoke({ version: 1 }),
        }).pipe(Effect.flip);

        expect(error).toContain("Invalid About reply");
      }
    })
);
