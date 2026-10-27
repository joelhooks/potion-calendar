import {
  notificationSettingsChannel,
  notificationSettingsWire,
} from "@calendar/core/desktop-bridge";
import { Effect, Fiber, Schema } from "effect";

import { acceptsDesktopFrame } from "./bridge-policy.js";
import { DesktopError } from "./config.js";
import { runNotificationSettings } from "./notification-settings.js";

interface NotificationSettingsFrame {
  readonly url: string;
}

interface NotificationSettingsContents {
  readonly mainFrame: NotificationSettingsFrame;
}

export interface NotificationSettingsWindow {
  readonly isDestroyed: () => boolean;
  readonly webContents: NotificationSettingsContents;
}

export interface NotificationSettingsEvent {
  readonly sender: NotificationSettingsContents;
  readonly senderFrame: NotificationSettingsFrame | null;
}

export type NotificationSettingsInvoke = (
  event: NotificationSettingsEvent,
  payload: Schema.Json
) => Promise<string>;

export interface NativeNotificationSettingsApi {
  readonly register: (
    channel: string,
    handler: NotificationSettingsInvoke
  ) => void;
  readonly remove: (channel: string) => void;
  readonly supported: () => boolean;
  readonly openExternal: (url: string) => Promise<void>;
}

export const installNotificationSettings = Effect.fn(
  "Desktop.installNotificationSettings"
)(function* installNotificationSettings(
  window: NotificationSettingsWindow,
  origin: string,
  macOS: boolean,
  api: NativeNotificationSettingsApi
) {
  const context = yield* Effect.context();
  const scope = yield* Effect.scope;
  const runPromise = Effect.runPromiseWith(context);

  const trusted = (event: NotificationSettingsEvent) =>
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    acceptsDesktopFrame(origin, event.senderFrame?.url ?? "", true);

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      api.register(
        notificationSettingsChannel,
        // @effect-diagnostics-next-line asyncFunction:off -- Electron's invoke boundary awaits the decoded request inside this window's owned Effect scope.
        async (event, payload): Promise<string> =>
          await runPromise(
            Schema.decodeUnknownEffect(notificationSettingsWire.request, {
              onExcessProperty: "error",
            })(payload).pipe(
              Effect.flatMap((request) =>
                runNotificationSettings(request, {
                  macOS,
                  open: (url) =>
                    Effect.tryPromise({
                      catch: () =>
                        new DesktopError({
                          message:
                            "System Settings could not be requested. Use the Apple menu to open Notifications.",
                        }),
                      // @effect-diagnostics-next-line asyncFunction:off -- Electron opens this fixed external protocol through its native Promise boundary.
                      try: async () => {
                        await api.openExternal(url);
                      },
                    }),
                  supported: Effect.try({
                    catch: () =>
                      new DesktopError({
                        message:
                          "Desktop notification support could not be checked.",
                      }),
                    try: api.supported,
                  }),
                  trusted: Effect.sync(() => trusted(event)),
                })
              ),
              Effect.flatMap(
                Schema.encodeEffect(notificationSettingsWire.reply)
              ),
              Effect.forkIn(scope),
              Effect.flatMap(Fiber.join)
            )
          )
      );
    }),
    () =>
      Effect.sync(() => {
        api.remove(notificationSettingsChannel);
      })
  );
});
