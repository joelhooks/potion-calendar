import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { DesktopError } from "../src/config.js";
import type { MacLaunchDecision } from "../src/mac-startup.js";
import { macLaunchDecision, startMacStartup } from "../src/mac-startup.js";

const fixture = Effect.fn("MacStartup.fixture")(function* fixture() {
  const gate = yield* Deferred.make<
    typeof MacLaunchDecision.Type,
    DesktopError
  >();

  const calls = yield* Ref.make<readonly string[]>([]);
  const issues = yield* Ref.make<readonly string[]>([]);

  const startup = yield* startMacStartup({
    read: Deferred.await(gate),
    report: (message) => Ref.update(issues, (values) => [...values, message]),
    show: Ref.update(calls, (values) => [...values, "show", "focus"]),
  });

  return { calls, gate, issues, startup };
});

const decide = (
  menuBar: boolean,
  calendar: boolean,
  openedAtLogin: boolean,
  feature = true,
  registered = true
) =>
  macLaunchDecision(openedAtLogin, {
    issues: [],
    macStartup: { calendar, menuBar },
    openAtLogin: registered,
    preferences: { ...defaultDesktopPreferences(), menuBar: feature },
    revision: 1,
  });

const resolveReady = Effect.fn("MacStartup.resolveReady")(
  function* resolveReady(
    value: Effect.Success<ReturnType<typeof fixture>>,
    decision: typeof MacLaunchDecision.Type,
    readyFirst: boolean
  ) {
    if (readyFirst) {
      yield* value.startup.ready;
      yield* TestClock.adjust(0);
    }

    yield* Deferred.succeed(value.gate, decision);
    yield* TestClock.adjust(0);

    if (!readyFirst) {
      expect(
        yield* Ref.get(value.calls),
        "the shell does not reveal before its ready event"
      ).toEqual([]);
      yield* value.startup.ready;
      yield* TestClock.adjust(0);
    }
  }
);

it.effect.prop(
  "HIGH a normal user launch always shows the shell for every startup choice",
  { readyFirst: Schema.Boolean },
  ({ readyFirst }) =>
    Effect.gen(function* userLaunchHistory() {
      for (const menuBar of [false, true]) {
        for (const calendar of [false, true]) {
          yield* Effect.gen(function* userChoice() {
            const value = yield* fixture();
            yield* resolveReady(
              value,
              decide(menuBar, calendar, false),
              readyFirst
            );
            expect(
              yield* Ref.get(value.calls),
              "HIGH a user launch cannot start hidden"
            ).toEqual(["show", "focus"]);
            expect(yield* Ref.get(value.issues)).toEqual([]);
          }).pipe(Effect.scoped);
        }
      }
    })
);

it.effect.prop(
  "a menu-only login launch keeps the loaded shell hidden with no show or focus",
  { readyFirst: Schema.Boolean },
  ({ readyFirst }) =>
    Effect.gen(function* trayOnlyLoginHistory() {
      const value = yield* fixture();
      yield* resolveReady(value, decide(true, false, true), readyFirst);
      expect(
        yield* Ref.get(value.calls),
        "a tray-only login must not reveal its shell"
      ).toEqual([]);
      expect(value.startup.actor.getSnapshot().matches("hidden")).toBe(true);
      expect(yield* Ref.get(value.issues)).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "a full calendar login shows the shell regardless of the disabled menu-start choice",
  { menuBar: Schema.Boolean, readyFirst: Schema.Boolean },
  ({ readyFirst, menuBar }) =>
    Effect.gen(function* calendarLoginHistory() {
      const value = yield* fixture();
      yield* resolveReady(value, decide(menuBar, true, true), readyFirst);
      expect(
        yield* Ref.get(value.calls),
        "full calendar startup must show and focus at login"
      ).toEqual(["show", "focus"]);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "a stale login without an eligible startup mode shows with a truthful issue",
  {
    readyFirst: Schema.Boolean,
    reason: Schema.Literals(["bothOff", "featureOff", "osOff"]),
  },
  ({ readyFirst, reason }) =>
    Effect.gen(function* staleLoginHistory() {
      const value = yield* fixture();

      const decision = decide(
        reason !== "bothOff",
        false,
        true,
        reason !== "featureOff",
        reason !== "osOff"
      );

      yield* resolveReady(value, decision, readyFirst);
      expect(yield* Ref.get(value.calls)).toEqual(["show", "focus"]);
      expect(yield* Ref.get(value.issues)).toEqual([
        "This login launch has no eligible startup mode. The calendar window is shown.",
      ]);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "an explicit open wins over late login policy and repeated ready events",
  { readyFirst: Schema.Boolean },
  ({ readyFirst }) =>
    Effect.gen(function* explicitOpenHistory() {
      const value = yield* fixture();

      if (readyFirst) {
        yield* value.startup.ready;
      }

      yield* value.startup.open;
      yield* TestClock.adjust(0);
      expect(yield* Ref.get(value.calls)).toEqual(["show", "focus"]);
      yield* Deferred.succeed(value.gate, decide(true, false, true));
      yield* value.startup.ready;
      yield* value.startup.ready;
      yield* TestClock.adjust(0);
      expect(yield* Ref.get(value.calls)).toEqual(["show", "focus"]);
      yield* value.startup.open;
      yield* TestClock.adjust(0);
      expect(yield* Ref.get(value.calls)).toEqual([
        "show",
        "focus",
        "show",
        "focus",
      ]);
    }).pipe(Effect.scoped)
);

it.effect(
  "an unreadable launch origin or startup setting shows instead of becoming inaccessible",
  () =>
    Effect.gen(function* unreadableStartupHistory() {
      const value = yield* fixture();
      yield* Deferred.fail(
        value.gate,
        new DesktopError({ message: "fake unreadable launch origin" })
      );
      yield* value.startup.ready;
      yield* TestClock.adjust(0);
      expect(yield* Ref.get(value.calls)).toEqual(["show", "focus"]);
      expect(yield* Ref.get(value.issues)).toEqual([
        "Startup settings could not be read. The calendar window is shown.",
      ]);
    }).pipe(Effect.scoped)
);

it.effect(
  "a later Dock, tray or second-instance open reveals a previously hidden shell",
  () =>
    Effect.gen(function* laterOpenHistory() {
      const value = yield* fixture();
      yield* resolveReady(value, decide(true, false, true), false);
      yield* value.startup.open;
      yield* TestClock.adjust(0);
      expect(yield* Ref.get(value.calls)).toEqual(["show", "focus"]);
      expect(value.startup.actor.getSnapshot().matches("shown")).toBe(true);
    }).pipe(Effect.scoped)
);
