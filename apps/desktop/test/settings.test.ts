import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";

import {
  makeNativeSettings,
  StoredDesktopPreferences,
} from "../src/settings.js";
import type { NativeSettingsPort } from "../src/settings.js";

const fakeSettings = Effect.fn("FakeSettings.make")(function* fakeSettings(
  stored: Option.Option<string> = Option.none()
) {
  const file = yield* Ref.make(stored);
  const os = yield* Ref.make(false);
  const changes = yield* Ref.make<readonly boolean[]>([]);
  const reads = yield* Ref.make(0);
  const rejected = yield* Ref.make<ReadonlySet<string>>(new Set());

  const registered = yield* Ref.make<ReadonlyMap<string, "menu" | "join">>(
    new Map()
  );

  const ignoreLoginChange = yield* Ref.make(false);

  const port: NativeSettingsPort = {
    login: Ref.get(os).pipe(
      Effect.tap(() => Ref.update(reads, (value) => value + 1))
    ),
    read: Ref.get(file),
    register: Effect.fn("FakeSettings.register")(function* register(
      accelerator: string,
      action: "menu" | "join"
    ) {
      if (
        (yield* Ref.get(rejected)).has(accelerator) ||
        (yield* Ref.get(registered)).has(accelerator)
      ) {
        return false;
      }

      yield* Ref.update(
        registered,
        (values) => new Map([...values, [accelerator, action]])
      );

      return true;
    }),
    setLogin: Effect.fn("FakeSettings.setLogin")(function* setLogin(
      enabled: boolean
    ) {
      yield* Ref.update(changes, (values) => [...values, enabled]);

      if (!(yield* Ref.get(ignoreLoginChange))) {
        yield* Ref.set(os, enabled);
      }
    }),
    unregister: (accelerator) =>
      Ref.update(registered, (values) => {
        const next = new Map(values);
        next.delete(accelerator);

        return next;
      }),
    write: (message) => Ref.set(file, Option.some(message)),
  };

  return {
    changes,
    file,
    ignoreLoginChange,
    os,
    port,
    reads,
    registered,
    rejected,
  };
});

it.effect(
  "uses the OS login value instead of an incompatible saved startup wish",
  () =>
    Effect.gen(function* loginTruth() {
      const stored = JSON.stringify({
        preferences: { ...defaultDesktopPreferences(), openAtLogin: true },
        version: 1,
      });

      const fake = yield* fakeSettings(Option.some(stored));
      const service = yield* makeNativeSettings(fake.port);
      const initial = yield* service.get;

      expect(initial.openAtLogin).toBe(false);
      expect(yield* Ref.get(fake.reads)).toBe(1);

      yield* Ref.set(fake.os, true);
      const externalChange = yield* service.get;

      expect(externalChange.openAtLogin).toBe(true);
      expect(externalChange.revision).toBeGreaterThan(initial.revision);
    })
);

it.effect(
  "changes the OS login item once and reports its observed result without storing a second authority",
  () =>
    Effect.gen(function* startupChange() {
      const fake = yield* fakeSettings();
      const service = yield* makeNativeSettings(fake.port);
      const changed = yield* service.startup(true);

      expect(yield* Ref.get(fake.changes)).toEqual([true]);
      expect(changed.settings.openAtLogin).toBe(true);
      expect(changed.error).toBeNull();
      expect(Option.isNone(yield* Ref.get(fake.file))).toBe(true);

      yield* Ref.set(fake.ignoreLoginChange, true);
      const refused = yield* service.startup(false);

      expect(yield* Ref.get(fake.changes)).toEqual([true, false]);
      expect(refused.settings.openAtLogin).toBe(true);
      expect(refused.error).not.toBeNull();
    })
);

it.effect(
  "reports failed shortcut registration and unsets the failed slot instead of keeping its old binding",
  () =>
    Effect.gen(function* shortcutConflict() {
      const fake = yield* fakeSettings();
      const service = yield* makeNativeSettings(fake.port);
      yield* Ref.set(fake.rejected, new Set(["Control+Shift+M"]));

      const changed = yield* service.save({
        ...defaultDesktopPreferences(),
        menuShortcut: "Control+Shift+M",
      });

      expect(changed.settings.preferences.menuShortcut).toBeNull();
      expect(changed.error).not.toBeNull();
      expect((yield* Ref.get(fake.registered)).has("Control+Command+K")).toBe(
        false
      );
      expect((yield* Ref.get(fake.registered)).get("Control+Command+J")).toBe(
        "join"
      );

      const saved = yield* Schema.decodeEffect(StoredDesktopPreferences)(
        Option.getOrThrow(yield* Ref.get(fake.file))
      );

      expect(saved.preferences.menuShortcut).toBeNull();
    })
);

it.effect(
  "unregisters owned shortcuts while disabled and when the owning scope closes",
  () =>
    Effect.gen(function* shortcutLifetime() {
      const fake = yield* fakeSettings();
      yield* Effect.gen(function* scopedSettings() {
        const service = yield* makeNativeSettings(fake.port);
        expect((yield* Ref.get(fake.registered)).size).toBe(2);

        yield* service.save({ ...defaultDesktopPreferences(), menuBar: false });
        expect((yield* Ref.get(fake.registered)).size).toBe(0);

        yield* service.save(defaultDesktopPreferences());
        expect((yield* Ref.get(fake.registered)).size).toBe(2);
      }).pipe(Effect.scoped);

      expect((yield* Ref.get(fake.registered)).size).toBe(0);
    })
);
