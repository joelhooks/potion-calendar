import {
  DesktopPreferences,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import type {
  DesktopPreferencesValue,
  DesktopSettingsValue,
} from "@calendar/core/desktop-bridge";
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect";

import { DesktopError } from "./config.js";

export const StoredDesktopPreferences = Schema.fromJsonString(
  Schema.Struct({
    preferences: DesktopPreferences,
    version: Schema.Literal(1),
  })
);

export interface NativeSettingsPort {
  readonly login: Effect.Effect<boolean, DesktopError>;
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
          onNone: () => Effect.succeed(defaultDesktopPreferences()),
          onSome: (text) =>
            Schema.decodeEffect(StoredDesktopPreferences)(text).pipe(
              Effect.map((value) => value.preferences)
            ),
        })
      ),
      Effect.catch(() =>
        Effect.logWarning("Desktop preferences could not be read").pipe(
          Effect.as(defaultDesktopPreferences())
        )
      )
    );

    const preferences = yield* Ref.make(saved);

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

    yield* apply(saved);

    const observe = Effect.gen(function* currentSettings(): Effect.fn.Return<
      DesktopSettingsValue,
      DesktopError
    > {
      return {
        issues: yield* Ref.get(issues),
        openAtLogin: yield* port.login,
        preferences: yield* Ref.get(preferences),
        revision: yield* Ref.updateAndGet(revision, (value) => value + 1),
      };
    });

    const save = Effect.fn("Desktop.savePreferences")(function* save(
      requested: DesktopPreferencesValue
    ) {
      const openAtLogin = yield* port.login;
      const applied = yield* apply(requested);

      const message = yield* Schema.encodeEffect(StoredDesktopPreferences)({
        preferences: applied,
        version: 1,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new DesktopError({
              cause,
              message: "Desktop preferences could not be encoded",
            })
        )
      );

      const error = yield* port.write(message).pipe(
        Effect.as<string | null>(null),
        Effect.orElseSucceed(
          () =>
            "Desktop preferences changed for this session but could not be saved."
        )
      );

      const currentIssues = yield* Ref.get(issues);

      const reported =
        error === null ? currentIssues : [...currentIssues, error];

      yield* Ref.set(issues, reported);

      return {
        error: error ?? currentIssues.at(0) ?? null,
        settings: {
          issues: reported,
          openAtLogin,
          preferences: applied,
          revision: yield* Ref.updateAndGet(revision, (value) => value + 1),
        },
      };
    }, Semaphore.withPermit(lock));

    const startup = Effect.fn("Desktop.setStartup")(function* startup(
      enabled: boolean
    ) {
      yield* port.setLogin(enabled);
      const current = yield* observe;

      return {
        error:
          current.openAtLogin === enabled
            ? null
            : "macOS has not applied the login-item change.",
        settings: current,
      };
    }, Semaphore.withPermit(lock));

    return {
      get: observe.pipe(Semaphore.withPermit(lock)),
      preferences: Ref.get(preferences),
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
