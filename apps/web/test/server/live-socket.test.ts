import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";

import { LiveNotice } from "../../src/client/live/protocol.js";
import {
  liveSocketStream,
  noticeAffectsSelection,
} from "../../src/client/live/socket.js";

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

      const stream = liveSocketStream(() => {
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
