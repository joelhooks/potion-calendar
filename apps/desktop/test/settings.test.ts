import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";

import { DesktopError } from "../src/config.js";
import {
  makeNativeSettings,
  StoredDesktopPreferences,
} from "../src/settings.js";
import type { NativeSettingsPort } from "../src/settings.js";

const fakeSettings = Effect.fn("FakeSettings.make")(function* fakeSettings(
  stored: Option.Option<string> = Option.none(),
  macStartup?: boolean
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
    macStartup: macStartup === true,
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

const startupFile = (calendar: boolean, menuBar: boolean) =>
  Option.some(
    JSON.stringify({
      macStartup: { calendar, menuBar },
      preferences: defaultDesktopPreferences(),
      version: 1,
    })
  );

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

it.effect(
  "an unreadable OS login state fails before any startup writer runs",
  () =>
    Effect.gen(function* unreadableOsStartup() {
      const fake = yield* fakeSettings(Option.none(), true);

      const failure = new DesktopError({
        message: "Fake OS login state unavailable",
      });

      const service = yield* makeNativeSettings({
        ...fake.port,
        login: Effect.fail(failure),
      });

      const observed = yield* Effect.exit(service.startup(true, "calendar"));
      expect(observed._tag).toBe("Failure");
      expect(yield* Ref.get(fake.changes)).toEqual([]);
      expect(Option.isNone(yield* Ref.get(fake.file))).toBe(true);
    })
);

it.effect(
  "a failed startup-intent write reports session-only mode without claiming it survives restart",
  () =>
    Effect.gen(function* failedStartupPersistence() {
      const fake = yield* fakeSettings(startupFile(false, false), true);

      const service = yield* makeNativeSettings({
        ...fake.port,
        write: () =>
          Effect.fail(
            new DesktopError({ message: "Fake intent write failed" })
          ),
      });

      const reply = yield* service.startup(true, "calendar");
      expect(reply.settings.openAtLogin).toBe(true);
      expect(reply.settings.macStartup).toEqual({
        calendar: true,
        menuBar: false,
      });
      expect(reply.error).toBe(
        "Desktop preferences changed for this session but could not be saved."
      );
      const restarted = yield* makeNativeSettings(fake.port);
      expect((yield* restarted.get).macStartup).toEqual({
        calendar: false,
        menuBar: false,
      });
      expect(yield* Ref.get(fake.changes)).toEqual([true]);
    })
);

it.effect(
  "a refused tray-only unregister keeps OS truth visible after disabling the menu feature",
  () =>
    Effect.gen(function* refusedTrayUnregister() {
      const fake = yield* fakeSettings(startupFile(false, true), true);
      yield* Ref.set(fake.os, true);
      yield* Ref.set(fake.ignoreLoginChange, true);
      const service = yield* makeNativeSettings(fake.port);

      const reply = yield* service.save({
        ...defaultDesktopPreferences(),
        menuBar: false,
      });

      expect(reply.error).toBe("macOS has not applied the login-item change.");
      expect(reply.settings.openAtLogin).toBe(true);
      expect(reply.settings.macStartup).toEqual({
        calendar: false,
        menuBar: true,
      });
      expect(reply.settings.preferences.menuBar).toBe(false);
      expect(yield* Ref.get(fake.changes)).toEqual([false]);
    })
);

it.effect.prop(
  "disabling the menu feature never unregisters full-calendar startup",
  { menuBar: Schema.Boolean },
  ({ menuBar }) =>
    Effect.gen(function* fullStartupFeatureOff() {
      const fake = yield* fakeSettings(startupFile(true, menuBar), true);
      yield* Ref.set(fake.os, true);
      const service = yield* makeNativeSettings(fake.port);

      const reply = yield* service.save({
        ...defaultDesktopPreferences(),
        menuBar: false,
      });

      expect(reply.error).toBeNull();
      expect(reply.settings.openAtLogin).toBe(true);
      expect(reply.settings.macStartup).toEqual({ calendar: true, menuBar });
      expect(yield* Ref.get(fake.changes)).toEqual([]);
    })
);

it.effect(
  "Mac startup defaults stay latent until the OS enables registration, without changing legacy preferences",
  () =>
    Effect.gen(function* startupDefaults() {
      const fake = yield* fakeSettings(Option.none(), true);
      const service = yield* makeNativeSettings(fake.port);
      expect((yield* service.get).macStartup).toEqual({
        calendar: false,
        menuBar: false,
      });
      expect(yield* Ref.get(fake.changes)).toEqual([]);
      yield* Ref.set(fake.os, true);
      expect((yield* service.get).macStartup).toEqual({
        calendar: true,
        menuBar: true,
      });
      expect(yield* Ref.get(fake.changes)).toEqual([]);
      const disabled = yield* service.startup(false);
      expect(disabled.settings.macStartup).toEqual({
        calendar: false,
        menuBar: true,
      });
      expect(disabled.settings.openAtLogin).toBe(true);

      const stored = yield* Schema.decodeEffect(StoredDesktopPreferences)(
        Option.getOrThrow(yield* Ref.get(fake.file))
      );

      expect(stored.macStartup).toEqual({ calendar: false, menuBar: true });
      expect(stored.preferences).toEqual(defaultDesktopPreferences());
    })
);

it.effect.prop(
  "Mac startup history preserves disabled menu intent, rejects forged menu changes and survives restart",
  { menuBar: Schema.Boolean },
  ({ menuBar }) =>
    Effect.gen(function* disabledStartupHistory() {
      const fake = yield* fakeSettings(startupFile(false, menuBar), true);
      yield* Ref.set(fake.os, true);
      const service = yield* makeNativeSettings(fake.port);
      const full = yield* service.startup(true, "calendar");
      expect(full.settings.macStartup).toEqual({ calendar: true, menuBar });
      const writes = yield* Ref.get(fake.changes);
      const rejected = yield* service.startup(!menuBar, "menuBar");
      expect(rejected.error).not.toBeNull();
      expect(yield* Ref.get(fake.changes)).toEqual(writes);
      const tray = yield* service.startup(false, "calendar");
      expect(tray.settings.openAtLogin).toBe(menuBar);
      expect(tray.settings.macStartup).toEqual({ calendar: false, menuBar });
      const restarted = yield* makeNativeSettings(fake.port);
      expect((yield* restarted.get).macStartup).toEqual(
        tray.settings.macStartup
      );
    })
);

it.effect(
  "a refused Mac OS registration change cannot be reported as successful or persist its requested mode",
  () =>
    Effect.gen(function* refusedMacStartup() {
      const fake = yield* fakeSettings(startupFile(false, false), true);
      yield* Ref.set(fake.ignoreLoginChange, true);
      const service = yield* makeNativeSettings(fake.port);
      const reply = yield* service.startup(true, "calendar");
      expect(
        reply.error,
        "a refused OS login-item change must not report success"
      ).not.toBeNull();
      expect(reply.settings.openAtLogin).toBe(false);
      expect(reply.settings.macStartup).toEqual({
        calendar: false,
        menuBar: false,
      });

      const stored = yield* Schema.decodeEffect(StoredDesktopPreferences)(
        Option.getOrThrow(yield* Ref.get(fake.file))
      );

      expect(stored.macStartup).toEqual({ calendar: false, menuBar: false });
      expect(yield* Ref.get(fake.changes)).toEqual([true]);
    })
);

it.effect(
  "external OS disablement is not undone by reads, unrelated saves or enabling the menu feature",
  () =>
    Effect.gen(function* externalStartupHistory() {
      const fake = yield* fakeSettings(startupFile(false, true), true);
      yield* Ref.set(fake.os, true);
      const service = yield* makeNativeSettings(fake.port);

      const disabled = yield* service.save({
        ...defaultDesktopPreferences(),
        menuBar: false,
      });

      expect(disabled.settings.openAtLogin).toBe(false);
      expect(yield* Ref.get(fake.changes)).toEqual([false]);
      yield* service.save(defaultDesktopPreferences());
      yield* service.save({ ...defaultDesktopPreferences(), showTime: false });
      expect((yield* service.get).macStartup).toEqual({
        calendar: false,
        menuBar: false,
      });
      expect(yield* Ref.get(fake.changes)).toEqual([false]);
      const explicit = yield* service.startup(true, "menuBar");
      expect(explicit.settings.macStartup).toEqual({
        calendar: false,
        menuBar: true,
      });
      yield* Ref.set(fake.os, false);
      yield* service.get;
      yield* service.save(defaultDesktopPreferences());
      expect(yield* Ref.get(fake.changes)).toEqual([false, true]);
    })
);

it.effect(
  "choosing menu startup after external OS disablement cannot resurrect a latent full-window choice",
  () =>
    Effect.gen(function* externalMenuChoice() {
      const fake = yield* fakeSettings(startupFile(true, true), true);
      const service = yield* makeNativeSettings(fake.port);
      const noop = yield* service.startup(false, "calendar");
      expect(noop.settings.openAtLogin).toBe(false);
      expect(yield* Ref.get(fake.changes)).toEqual([]);
      const menu = yield* service.startup(true, "menuBar");
      expect(menu.settings.macStartup).toEqual({
        calendar: false,
        menuBar: true,
      });
      expect(yield* Ref.get(fake.changes)).toEqual([true]);
      yield* service.save({ ...defaultDesktopPreferences(), menuBar: false });
      const rejected = yield* service.startup(true, "menuBar");
      expect(rejected.error).not.toBeNull();
      expect(yield* Ref.get(fake.changes)).toEqual([true, false]);
    })
);

it.effect.prop(
  "legacy and malformed private files retain safe Mac defaults without registering a login item",
  { malformed: Schema.Boolean },
  ({ malformed }) =>
    Effect.gen(function* oldStartupFile() {
      const old = malformed
        ? "not valid JSON"
        : JSON.stringify({
            preferences: { ...defaultDesktopPreferences(), showTime: false },
            version: 1,
          });

      const fake = yield* fakeSettings(Option.some(old), true);
      const service = yield* makeNativeSettings(fake.port);
      yield* Ref.set(fake.os, true);
      const observed = yield* service.get;
      expect(observed.macStartup).toEqual({ calendar: true, menuBar: true });
      expect(observed.preferences.showTime).toBe(malformed);
      expect(yield* Ref.get(fake.changes)).toEqual([]);
    })
);
