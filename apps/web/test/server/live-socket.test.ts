import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";

import { LiveNotice } from "../../src/client/live/protocol.js";
import {
  liveSocketStream,
  noticeAffectsSelection,
} from "../../src/client/live/socket.js";

const closeEvent = (code: number, reason = "") =>
  Object.assign(new Event("close"), { code, reason });

class FixtureSocket extends EventTarget {
  closed = 0;
  close(): void {
    this.closed += 1;
  }
}

it.effect(
  "socket reconnects, decodes only shared notices and closes on subscription disposal",
  () =>
    Effect.gen(function* scopedSocket() {
      const created = yield* Queue.unbounded<FixtureSocket>();
      const notices = yield* Queue.unbounded<typeof LiveNotice.Type>();

      const stream = liveSocketStream("person-a", () => {
        const socket = new FixtureSocket();
        Queue.offerUnsafe(created, socket);

        return socket;
      });

      const running = yield* Stream.runForEach(stream, (notice) =>
        Queue.offer(notices, notice)
      ).pipe(Effect.forkScoped);

      const first = yield* Queue.take(created);
      first.dispatchEvent(new Event("open"));
      expect(yield* Queue.take(notices)).toEqual(
        LiveNotice.cases.Reconnected.make({})
      );
      first.dispatchEvent(new MessageEvent("message", { data: "not-json" }));
      first.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ accessToken: "must-not-be-a-notice" }),
        })
      );
      first.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            accountId: "account-a",
            calendarId: "calendar-a",
            reason: "sync",
            version: 2,
          }),
        })
      );
      const changed = yield* Queue.take(notices);
      expect(changed).toEqual(
        LiveNotice.cases.CalendarChanged.make({
          change: {
            accountId: "account-a",
            calendarId: "calendar-a",
            reason: "sync",
            version: 2,
          },
        })
      );
      expect(
        noticeAffectsSelection(changed, [
          { accountId: "account-a", calendarId: "calendar-a" },
        ])
      ).toBe(true);
      expect(
        noticeAffectsSelection(changed, [
          { accountId: "account-b", calendarId: "calendar-a" },
        ])
      ).toBe(false);
      first.dispatchEvent(new Event("close"));
      yield* TestClock.adjust(1000);
      const second = yield* Queue.take(created);
      expect(first.closed).toBe(1);
      second.dispatchEvent(new Event("open"));
      expect(yield* Queue.take(notices)).toEqual(
        LiveNotice.cases.Reconnected.make({})
      );
      yield* Fiber.interrupt(running);
      expect(second.closed).toBe(1);
    })
);

it.effect.each([
  { code: 1008, connected: true, deleted: true, reason: "Account deleted" },
  {
    code: 1008,
    connected: true,
    deleted: false,
    reason: "Session unavailable",
  },
  { code: 1006, connected: false, deleted: false, reason: "" },
])(
  "close $code ($reason) with a null session terminates without reconnecting",
  ({ code, reason, connected, deleted }) =>
    Effect.gen(function* endedSession() {
      const created = yield* Queue.unbounded<FixtureSocket>();
      const notices = yield* Queue.unbounded<typeof LiveNotice.Type>();
      let checks = 0;
      let connections = 0;

      const running = yield* liveSocketStream(
        "person-a",
        () => {
          const socket = new FixtureSocket();
          connections += 1;
          Queue.offerUnsafe(created, socket);

          return socket;
        },
        Effect.sync(() => {
          checks += 1;

          return false;
        })
      ).pipe(
        Stream.runForEach((notice) => Queue.offer(notices, notice)),
        Effect.forkScoped
      );

      const socket = yield* Queue.take(created);

      if (connected) {
        socket.dispatchEvent(new Event("open"));
        expect(yield* Queue.take(notices)).toEqual(
          LiveNotice.cases.Reconnected.make({})
        );
      }

      socket.dispatchEvent(closeEvent(code, reason));
      expect(yield* Queue.take(notices)).toEqual(
        LiveNotice.cases.SessionEnded.make({ deleted })
      );
      yield* Fiber.join(running);
      yield* TestClock.adjust(120_000);
      expect(checks).toBe(1);
      expect(connections).toBe(1);
      expect(socket.closed).toBe(1);
    })
);

it.effect(
  "1006 reconnect failure with a live session preserves backoff and resets it on a successful open",
  () =>
    Effect.gen(function* liveRetry() {
      const created = yield* Queue.unbounded<FixtureSocket>();
      const notices = yield* Queue.unbounded<typeof LiveNotice.Type>();
      let checks = 0;

      const running = yield* liveSocketStream(
        "person-a",
        () => {
          const socket = new FixtureSocket();
          Queue.offerUnsafe(created, socket);

          return socket;
        },
        Effect.sync(() => {
          checks += 1;

          return true;
        })
      ).pipe(
        Stream.runForEach((notice) => Queue.offer(notices, notice)),
        Effect.forkScoped
      );

      const first = yield* Queue.take(created);
      first.dispatchEvent(new Event("open"));
      yield* Queue.take(notices);
      first.dispatchEvent(closeEvent(1006));
      yield* TestClock.adjust(1000);
      const second = yield* Queue.take(created);
      expect(checks).toBe(0);
      second.dispatchEvent(closeEvent(1006));
      yield* TestClock.adjust(2000);
      const third = yield* Queue.take(created);
      expect(checks).toBe(1);
      third.dispatchEvent(new Event("open"));
      expect(yield* Queue.take(notices)).toEqual(
        LiveNotice.cases.Reconnected.make({})
      );
      third.dispatchEvent(closeEvent(1006));
      yield* TestClock.adjust(1000);
      const fourth = yield* Queue.take(created);
      expect(checks).toBe(1);
      yield* Fiber.interrupt(running);
      expect(fourth.closed).toBe(1);
    })
);
