import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { DateTime, Deferred, Effect, Option, Queue, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";

import { NativeIntent, startNativeHost } from "../src/native-host.js";
import type { NativeView } from "../src/native-host.js";
import { trayIconState } from "../src/tray-icon.js";
import type { TrayIconState } from "../src/tray-icon.js";
import { trayEvent } from "./tray-current-fixture.js";

it.effect(
  "clock and agenda changes do not cancel an accepted native action",
  () =>
    Effect.gen(function* actionHistory() {
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const finished = yield* Ref.make(false);

      const rendered = yield* Ref.make<Option.Option<NativeView>>(
        Option.none()
      );

      const host = yield* startNativeHost(
        {
          intents: Stream.never,
          perform: () =>
            Deferred.succeed(entered, true).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(Ref.set(finished, true))
            ),
          render: (view) => Ref.set(rendered, Option.some(view)),
        },
        { now: 0, preferences: defaultDesktopPreferences() }
      );

      yield* waitFor(
        host.actor,
        (snapshot) => snapshot.matches({ active: "idle" }),
        { timeout: "2 seconds" }
      ).pipe(Effect.orDie);
      yield* send(host.actor, {
        intent: NativeIntent.cases.OpenWindow.make({}),
        type: "Intent",
      });
      yield* Deferred.await(entered);
      yield* send(host.actor, { now: 30_000, type: "Tick" });
      yield* send(host.actor, { snapshot: { events: [] }, type: "Agenda" });

      const pending = yield* waitFor(
        host.actor,
        (snapshot) => snapshot.context.now === 30_000,
        { timeout: "2 seconds" }
      ).pipe(Effect.orDie);

      expect(pending.matches({ active: "acting" })).toBe(true);
      yield* Deferred.succeed(release, true);
      yield* waitFor(
        host.actor,
        (snapshot) => snapshot.matches({ active: "idle" }),
        { timeout: "2 seconds" }
      ).pipe(Effect.orDie);
      expect(yield* Ref.get(finished)).toBe(true);
      expect(
        (yield* Ref.get(rendered)).pipe(Option.map((view) => view.now))
      ).toEqual(Option.some(30_000));
    })
);

it.effect(
  "replaces a pending view rather than letting an old render finish last",
  () =>
    Effect.gen(function* renderingHistory() {
      const entered = yield* Deferred.make<boolean>();
      const cancelled = yield* Deferred.make<boolean>();
      const rendered = yield* Ref.make(-1);

      const host = yield* startNativeHost(
        {
          intents: Stream.never,
          perform: () => Effect.void,
          render: (view) =>
            view.now === 0
              ? Effect.acquireRelease(Deferred.succeed(entered, true), () =>
                  Deferred.succeed(cancelled, true)
                ).pipe(Effect.andThen(Effect.never), Effect.scoped)
              : Ref.set(rendered, view.now),
        },
        { now: 0, preferences: defaultDesktopPreferences() }
      );

      yield* Deferred.await(entered);
      yield* send(host.actor, { now: 1000, type: "Tick" });
      yield* Deferred.await(cancelled);
      yield* waitFor(
        host.actor,
        (snapshot) => snapshot.matches({ active: "idle" }),
        { timeout: "2 seconds" }
      ).pipe(Effect.orDie);
      expect(yield* Ref.get(rendered)).toBe(1000);
      yield* send(host.actor, { type: "Quit" });
      yield* host.done;
    })
);

it.effect.each([
  { day: 28, month: 2, next: 29 },
  { day: 29, month: 2, next: 1 },
  { day: 31, month: 12, next: 1 },
])(
  "existing minute clock rolls $month/$day to $next and applies agenda changes",
  ({ month, day, next }) =>
    Effect.gen(function* localRollover() {
      const now = DateTime.toEpochMillis(
        DateTime.makeZonedUnsafe(
          { day, hour: 23, minute: 59, month, year: 2028 },
          { adjustForTimeZone: true, timeZone: DateTime.zoneMakeLocal() }
        )
      );

      yield* TestClock.setTime(now);
      const images = yield* Queue.unbounded<TrayIconState>();

      const host = yield* startNativeHost(
        {
          intents: Stream.never,
          perform: () => Effect.void,
          render: (view) =>
            Queue.offer(images, trayIconState(view)).pipe(Effect.asVoid),
        },
        { now, preferences: defaultDesktopPreferences() }
      );

      expect(yield* Queue.take(images)).toEqual({ day, mark: "date-only" });
      yield* waitFor(
        host.actor,
        (snapshot) => snapshot.matches({ active: "idle" }),
        { timeout: "2 seconds" }
      ).pipe(Effect.orDie);
      yield* TestClock.adjust(60_000);
      expect(yield* Queue.take(images)).toEqual({
        day: next,
        mark: "date-only",
      });
      const event = trayEvent("after-midnight");
      yield* send(host.actor, {
        snapshot: {
          events: [
            {
              ...event,
              end: now + 120_000,
              rsvp: { enabled: true, response: "tentative" },
              start: now + 60_000,
            },
          ],
        },
        type: "Agenda",
      });
      expect(yield* Queue.take(images)).toEqual({
        day: next,
        mark: "tentative",
      });
      yield* send(host.actor, { type: "Quit" });
      yield* host.done;
    })
);
