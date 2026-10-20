import {
  DesktopSettings,
  DesktopSettingsReply,
} from "@calendar/core/desktop-bridge";
import type {
  DesktopBridge,
  DesktopPreferencesValue,
} from "@calendar/core/desktop-bridge";
import { Effect, Schema } from "effect";

export class DesktopBridgeError extends Schema.TaggedError<DesktopBridgeError>()(
  "DesktopBridgeError",
  { message: Schema.String }
) {}

const failure = () =>
  new DesktopBridgeError({
    message: "Desktop settings are unavailable. Try again in the desktop app.",
  });

export const readDesktopSettings = Effect.fn("Desktop.readBrowserSettings")(
  function* readDesktopSettings(bridge: DesktopBridge) {
    const reply = yield* Effect.tryPromise({
      catch: failure,
      // @effect-diagnostics-next-line asyncFunction:off -- This adapter reads the isolated preload's native Promise without widening the browser bridge.
      try: async () => await bridge.getSettings(),
    });

    return yield* Schema.decodeEffect(DesktopSettings)(reply).pipe(
      Effect.mapError(failure)
    );
  }
);

export const saveDesktopPreferences = Effect.fn(
  "Desktop.saveBrowserPreferences"
)(function* saveDesktopPreferences(
  bridge: DesktopBridge,
  preferences: DesktopPreferencesValue
) {
  const reply = yield* Effect.tryPromise({
    catch: failure,
    // @effect-diagnostics-next-line asyncFunction:off -- Preferences cross the typed native Promise boundary and are decoded again in the browser.
    try: async () => await bridge.savePreferences(preferences),
  });

  return yield* Schema.decodeEffect(DesktopSettingsReply)(reply).pipe(
    Effect.mapError(failure)
  );
});

export const setDesktopStartup = Effect.fn("Desktop.setBrowserStartup")(
  function* setDesktopStartup(bridge: DesktopBridge, enabled: boolean) {
    const reply = yield* Effect.tryPromise({
      catch: failure,
      // @effect-diagnostics-next-line asyncFunction:off -- macOS owns the startup result; the browser never stores an optimistic second startup truth.
      try: async () => await bridge.setStartup({ enabled }),
    });

    return yield* Schema.decodeEffect(DesktopSettingsReply)(reply).pipe(
      Effect.mapError(failure)
    );
  }
);
