// oxlint-disable typescript/promise-function-async -- Faithful native Promise fakes resolve or reject without a second Effect runtime or artificial scheduling.
import {
  NotificationSettingsRequest,
  NotificationSettingsReply,
  deskDefaultMacNotificationSettingsUrl,
  notificationSettingsChannel,
  notificationSettingsWire,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { createDesktopBridge } from "../src/bridge-client.js";
import { installNotificationSettings } from "../src/native-notification-settings.js";
import type {
  NotificationSettingsEvent,
  NotificationSettingsInvoke,
} from "../src/native-notification-settings.js";

const bridgeFixture = Effect.fn("test.notificationSettingsBridge")(
  function* bridgeFixture() {
    const frame = {
      url: "https://calendar.example.test/settings/notifications",
    };

    const contents = { mainFrame: frame };

    const state = {
      destroyed: false,
      fail: false,
      handler: Option.none<NotificationSettingsInvoke>(),
      supported: true,
    };

    const calls: string[] = [];
    const removed: string[] = [];

    const event: NotificationSettingsEvent = {
      sender: contents,
      senderFrame: frame,
    };

    yield* installNotificationSettings(
      { isDestroyed: () => state.destroyed, webContents: contents },
      "https://calendar.example.test",
      true,
      {
        openExternal: (url) => {
          calls.push(url);

          return state.fail
            ? Promise.reject(new Error("private native detail"))
            : Promise.resolve();
        },
        register: (channel, handler) => {
          expect(channel).toBe(notificationSettingsChannel);
          state.handler = Option.some(handler);
        },
        remove: (channel) => {
          removed.push(channel);
          state.handler = Option.none();
        },
        supported: () => state.supported,
      }
    );

    const bridge = createDesktopBridge({
      getSettings: () => Promise.resolve("invalid"),
      joinMeeting: () => Promise.resolve("invalid"),
      // @effect-diagnostics-next-line asyncFunction:off -- The actual isolated codec invokes the actual installed handler with its native Promise contract.
      notificationSettings: async (message) =>
        await Option.getOrThrow(state.handler)(event, message),
      publishAgenda: () => {},
      rejected: () => {},
      savePreferences: () => Promise.resolve("invalid"),
      setStartup: () => Promise.resolve("invalid"),
      subscribeActions: () => () => {},
      subscribeSettings: () => () => {},
    });

    return { bridge, calls, contents, event, frame, removed, state };
  }
);

it.effect(
  "the actual isolated bridge and registered main handler open only the fixed destination after an admitted Open",
  () =>
    Effect.gen(function* settingsBridgeRoundTrip() {
      const f = yield* bridgeFixture();

      const invoke = Option.getOrThrow(
        Option.fromUndefinedOr(f.bridge.notificationSettings)
      );

      expect(f.calls).toEqual([]);

      const read = yield* Effect.promise(() =>
        invoke(NotificationSettingsRequest.cases.Read.make({ version: 1 }))
      );

      expect(read).toEqual(
        NotificationSettingsReply.cases.Read.make({
          permission: { authorization: "unknown", supported: true },
          version: 1,
        })
      );
      expect(f.calls).toEqual([]);
      expect(
        yield* Effect.promise(() =>
          invoke(NotificationSettingsRequest.cases.Open.make({ version: 1 }))
        )
      ).toEqual(NotificationSettingsReply.cases.Requested.make({ version: 1 }));
      expect(f.calls).toEqual([deskDefaultMacNotificationSettingsUrl.url]);
      f.state.fail = true;

      const failed = yield* Effect.promise(() =>
        invoke(NotificationSettingsRequest.cases.Open.make({ version: 1 }))
      );

      expect(failed._tag).toBe("Failed");
      expect(JSON.stringify(failed)).not.toContain("private native detail");
    }).pipe(Effect.scoped)
);

it.effect(
  "wrong windows, subframes, stale origins, destroyed owners and URL-bearing requests never reach the native shell",
  () =>
    Effect.gen(function* settingsBridgeTrust() {
      const f = yield* bridgeFixture();
      const handle = Option.getOrThrow(f.state.handler);

      const open = yield* Schema.encodeEffect(notificationSettingsWire.request)(
        NotificationSettingsRequest.cases.Open.make({ version: 1 })
      );

      for (const event of [
        { sender: { mainFrame: f.frame }, senderFrame: f.frame },
        { sender: f.contents, senderFrame: { url: f.frame.url } },
        { sender: f.contents, senderFrame: null },
      ]) {
        const result = yield* Effect.promise(() => handle(event, open)).pipe(
          Effect.flatMap(Schema.decodeEffect(notificationSettingsWire.reply))
        );

        expect(result._tag).toBe("Failed");
      }

      f.frame.url = "https://hostile.example.test/";
      expect(
        (yield* Effect.promise(() => handle(f.event, open)).pipe(
          Effect.flatMap(Schema.decodeEffect(notificationSettingsWire.reply))
        ))._tag
      ).toBe("Failed");
      f.frame.url = "https://calendar.example.test/";
      f.state.destroyed = true;
      expect(
        (yield* Effect.promise(() => handle(f.event, open)).pipe(
          Effect.flatMap(Schema.decodeEffect(notificationSettingsWire.reply))
        ))._tag
      ).toBe("Failed");
      f.state.destroyed = false;

      const malformed = yield* Effect.tryPromise({
        catch: () => "rejected",
        try: () =>
          handle(
            f.event,
            JSON.stringify({
              ...NotificationSettingsRequest.cases.Open.make({ version: 1 }),
              url: "https://hostile.example.test/",
            })
          ),
      }).pipe(Effect.option);

      expect(Option.isNone(malformed)).toBe(true);
      expect(f.calls).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "the owning scope removes only the notification-settings handler",
  () =>
    Effect.gen(function* settingsBridgeDisposal() {
      const f = yield* bridgeFixture().pipe(Effect.scoped);
      expect(f.removed).toEqual([notificationSettingsChannel]);
      expect(Option.isNone(f.state.handler)).toBe(true);
    })
);
