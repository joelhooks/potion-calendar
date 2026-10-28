import {
  DesktopPreferences,
  MacStartupIntent,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import type {
  DesktopPreferencesValue,
  DesktopSettingsValue,
  MacStartupTarget,
} from "@calendar/core/desktop-bridge";
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect";

import { DesktopError } from "./config.js";

export const StoredDesktopPreferences = Schema.fromJsonString(
  Schema.Struct({
    macStartup: Schema.optional(MacStartupIntent),
    preferences: DesktopPreferences,
    version: Schema.Literal(1),
  })
);

const initialStoredPreferences = (): typeof StoredDesktopPreferences.Type => ({
  preferences: defaultDesktopPreferences(),
  version: 1,
});

export interface NativeSettingsPort {
  readonly login: Effect.Effect<boolean, DesktopError>;
  readonly macStartup?: boolean;
  readonly read: Effect.Effect<Option.Option<string>, DesktopError>;
  readonly register: (
    accelerator: string,
    action: "menu" | "join"
  ) => Effect.Effect<boolean, DesktopError>;
  readonly setLogin: (enabled: boolean) => Effect.Effect<void, DesktopError>;
  readonly unregister: (
    accelerator: string
  ) => Effect.Effect<void, DesktopError>;
  readonly write: (message: string) => Effect.Effect<void, DesktopError>;
}

const slots: readonly {
  readonly field: "menuShortcut" | "joinShortcut";
  readonly action: "menu" | "join";
}[] = [
  { action: "menu", field: "menuShortcut" },
  { action: "join", field: "joinShortcut" },
];

interface RegisteredShortcut {
  readonly accelerator: string;
  readonly action: "menu" | "join";
}

export const makeNativeSettings = Effect.fn("Desktop.makeNativeSettings")(
  function* makeNativeSettings(port: NativeSettingsPort) {
    const lock = yield* Semaphore.make(1);
    const active = yield* Ref.make<readonly RegisteredShortcut[]>([]);
    const issues = yield* Ref.make<readonly string[]>([]);
    const revision = yield* Ref.make(0);

    const saved = yield* port.read.pipe(
      Effect.flatMap((message) =>
        Option.match(message, {
          onNone: () => Effect.succeed(initialStoredPreferences()),
          onSome: Schema.decodeEffect(StoredDesktopPreferences),
        })
      ),
      Effect.catch(() =>
        Effect.logWarning("Desktop preferences could not be read").pipe(
          Effect.as(initialStoredPreferences())
        )
      )
    );

    const preferences = yield* Ref.make(saved.preferences);

    const startupIntent = yield* Ref.make(
      saved.macStartup ??
        MacStartupIntent.make({ calendar: true, menuBar: true })
    );

    const reportStartupIssue = (message: string) =>
      Ref.update(issues, (values) => [...new Set([...values, message])]);

    const unregister = Effect.fn("Desktop.unregisterShortcuts")(
      function* unregister() {
        const owned = yield* Ref.get(active);

        yield* Effect.forEach(
          owned,
          (binding) => port.unregister(binding.accelerator),
          { discard: true }
        );
        yield* Ref.set(active, []);
      }
    );

    yield* Effect.addFinalizer(() =>
      unregister().pipe(
        Effect.catch(() =>
          Effect.logWarning("Desktop shortcuts could not be released")
        )
      )
    );

    const apply = Effect.fn("Desktop.applyPreferences")(function* apply(
      requested: DesktopPreferencesValue
    ) {
      const owned = yield* Ref.get(active);
      const retained: RegisteredShortcut[] = [];

      for (const binding of owned) {
        const slot = slots.find(
          (candidate) => candidate.action === binding.action
        );

        if (
          requested.menuBar &&
          slot !== undefined &&
          requested[slot.field] === binding.accelerator
        ) {
          retained.push(binding);
        } else {
          yield* port.unregister(binding.accelerator);
        }
      }

      yield* Ref.set(active, retained);
      const applied = { ...requested };
      const unavailable: string[] = [];

      if (requested.menuBar) {
        for (const slot of slots) {
          const accelerator = requested[slot.field];

          if (
            accelerator === null ||
            retained.some(
              (binding) =>
                binding.action === slot.action &&
                binding.accelerator === accelerator
            )
          ) {
            continue;
          }

          const registered = yield* port
            .register(accelerator, slot.action)
            .pipe(Effect.orElseSucceed(() => false));

          if (registered) {
            yield* Ref.update(active, (values) => [
              ...values,
              { accelerator, action: slot.action },
            ]);
          } else {
            applied[slot.field] = null;
            unavailable.push(
              slot.action === "menu"
                ? "The menu-bar shortcut is unavailable and is now unset."
                : "The join shortcut is unavailable and is now unset."
            );
          }
        }
      }

      yield* Ref.set(preferences, applied);
      yield* Ref.set(issues, unavailable);

      return applied;
    }, Effect.uninterruptible);

    yield* apply(saved.preferences);

    const observe = Effect.gen(function* currentSettings(): Effect.fn.Return<
      DesktopSettingsValue,
      DesktopError
    > {
      const openAtLogin = yield* port.login;
      const intent = yield* Ref.get(startupIntent);

      const current: DesktopSettingsValue = {
        issues: yield* Ref.get(issues),
        openAtLogin,
        preferences: yield* Ref.get(preferences),
        revision: yield* Ref.updateAndGet(revision, (value) => value + 1),
      };

      return port.macStartup === true
        ? {
            ...current,
            macStartup: {
              calendar: openAtLogin && intent.calendar,
              menuBar: openAtLogin && intent.menuBar,
            },
          }
        : current;
    });

    const persist = Effect.gen(function* persistSettings() {
      const stored: typeof StoredDesktopPreferences.Type = {
        preferences: yield* Ref.get(preferences),
        version: 1,
      };

      const current =
        port.macStartup === true
          ? { ...stored, macStartup: yield* Ref.get(startupIntent) }
          : stored;

      const message = yield* Schema.encodeEffect(StoredDesktopPreferences)(
        current
      ).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopError({
              cause,
              message: "Desktop preferences could not be encoded",
            })
        )
      );

      return yield* port.write(message).pipe(
        Effect.as<string | null>(null),
        Effect.orElseSucceed(
          () =>
            "Desktop preferences changed for this session but could not be saved."
        )
      );
    });

    const save = Effect.fn("Desktop.savePreferences")(function* save(
      requested: DesktopPreferencesValue
    ) {
      const before = yield* observe;
      yield* apply(requested);

      if (
        before.preferences.menuBar &&
        !requested.menuBar &&
        before.macStartup?.menuBar === true &&
        !before.macStartup.calendar
      ) {
        yield* port.setLogin(false);

        if (yield* port.login) {
          yield* reportStartupIssue(
            "macOS has not applied the login-item change."
          );
        }
      }

      const error = yield* persist;

      if (error !== null) {
        yield* reportStartupIssue(error);
      }

      const current = yield* observe;

      return {
        error: error ?? current.issues.at(0) ?? null,
        settings: current,
      };
    }, Semaphore.withPermit(lock));

    const startup = Effect.fn("Desktop.setStartup")(function* startup(
      enabled: boolean,
      target: typeof MacStartupTarget.Type = "calendar"
    ) {
      const before = yield* observe;

      if (port.macStartup !== true) {
        if (target === "menuBar") {
          return {
            error: "Menu-bar startup is available only on macOS.",
            settings: before,
          };
        }

        yield* port.setLogin(enabled);
        const current = yield* observe;

        return {
          error:
            current.openAtLogin === enabled
              ? null
              : "macOS has not applied the login-item change.",
          settings: current,
        };
      }

      if (
        target === "menuBar" &&
        (!before.preferences.menuBar || before.macStartup?.calendar === true)
      ) {
        return {
          error: "Menu-bar startup is disabled by the current settings.",
          settings: before,
        };
      }

      const effective =
        before.macStartup ??
        MacStartupIntent.make({ calendar: false, menuBar: false });

      if (effective[target] === enabled) {
        return { error: null, settings: before };
      }

      const remembered = yield* Ref.get(startupIntent);

      const requested =
        target === "calendar"
          ? { ...remembered, calendar: enabled }
          : { calendar: effective.calendar, menuBar: enabled };

      const desiredLogin =
        requested.calendar || (before.preferences.menuBar && requested.menuBar);

      yield* port.setLogin(desiredLogin);
      const observedLogin = yield* port.login;

      if (observedLogin !== desiredLogin) {
        yield* reportStartupIssue(
          "macOS has not applied the login-item change."
        );

        return {
          error: "macOS has not applied the login-item change.",
          settings: yield* observe,
        };
      }

      yield* Ref.set(startupIntent, requested);
      const error = yield* persist;

      if (error !== null) {
        yield* reportStartupIssue(error);
      }

      return { error, settings: yield* observe };
    }, Semaphore.withPermit(lock));

    return {
      get: observe.pipe(Semaphore.withPermit(lock)),
      preferences: Ref.get(preferences),
      reportStartupIssue,
      save,
      startup,
    };
  }
);

export class NativeSettings extends Context.Service<
  NativeSettings,
  Effect.Success<ReturnType<typeof makeNativeSettings>>
>()("@calendar/desktop/NativeSettings") {
  static readonly layer = (port: NativeSettingsPort) =>
    Layer.effect(NativeSettings, makeNativeSettings(port));
}
