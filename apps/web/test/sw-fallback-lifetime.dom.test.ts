import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Queue, Result, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";

import { browserNotifications } from "../src/client/reminders/browser.js";
import type { NotificationEvent } from "../src/client/reminders/model.js";
import {
  nativeNotificationGate,
  notificationBrowserFixture,
  workerContent,
} from "./sw-notifications-fixture.js";
import { expectNotificationPermissionBarrier } from "./sw-notifications-observation.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.effect.each(["disconnect", "close"])(
  "a %s during the worker-to-plain close wait cannot revive a presentation",
  (invalidation) =>
    Effect.gen(function* fallbackCloseLifetime() {
      const fixture = notificationBrowserFixture();
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);
      const port = browserNotifications();
      const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();

      const observer = yield* port.observe(notification.personId).pipe(
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkScoped
      );

      yield* Queue.take(events);
      yield* port.show(notification);
      expect(fixture.presented).toHaveLength(1);
      Object.defineProperty(fixture.registration, "active", { value: null });
      fixture.register.mockRejectedValue(new Error("Registration unavailable"));
      const gate = nativeNotificationGate();
      const entered = yield* Queue.unbounded<true>();
      fixture.registration.getNotifications.mockImplementationOnce(
        // @effect-diagnostics-next-line asyncFunction:off -- This native close query remains pending while the real adapter loses its presentation lease.
        async () => {
          Queue.offerUnsafe(entered, true);
          await gate.promise;

          return fixture.presented;
        }
      );
      const delivery = yield* port.show(notification).pipe(Effect.forkScoped);
      yield* Queue.take(entered);

      yield* invalidation === "disconnect"
        ? Fiber.interrupt(observer)
        : port.close(notification.personId, [notification.id]);

      gate.release();
      const outcome = yield* Fiber.join(delivery).pipe(Effect.result);
      expect(
        fixture.plain,
        "Revoked fallback must construct no plain notification"
      ).toHaveLength(0);
      expect(
        Result.isFailure(outcome),
        "Revoked fallback must not report successful delivery"
      ).toBe(true);

      if (Result.isFailure(outcome)) {
        expect(outcome.failure.reason).toBe("inactive");
      }

      expect(fixture.presented).toHaveLength(1);
      expect(fixture.latest().closed).toBe(1);

      if (invalidation === "close") {
        yield* expectNotificationPermissionBarrier(
          events,
          notification.personId
        );
      } else {
        expect(yield* Queue.size(events)).toBe(0);
      }
    })
);
