import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Queue, Result, Stream } from "effect";
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

const connect = Effect.fn("test.connectNotificationLifetime")(function* connect(
  personId: string
) {
  const port = browserNotifications();
  const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
  yield* port.observe(personId).pipe(
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.forkScoped
  );
  yield* Queue.take(events);

  return { events, port };
});

const combinations = [false, true].flatMap((join) =>
  [false, true].flatMap((email) =>
    [false, true].flatMap((future) =>
      [false, true].flatMap((snooze) =>
        [0, 1, 2, 5].map((slots) => ({ email, future, join, slots, snooze }))
      )
    )
  )
);

it.effect.each(combinations)(
  "fake registration covers the complete priority and slot matrix: %j",
  ({ email, future, join, slots, snooze }) =>
    Effect.gen(function* allWorkerSlots() {
      const fixture = notificationBrowserFixture();
      fixture.PlainNotification.maxActions = slots;
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);
      const available: ("join" | "email" | "start")[] = [];
      const expected: string[] = [];

      if (join) {
        available.push("join");
        expected.push("join");
      }

      if (email) {
        available.push("email");
        expected.push("email");
      }

      if (snooze) {
        available.push("start");

        if (future) {
          expected.push("start");
        }
      }

      const { port } = yield* connect(notification.personId);
      yield* port.show({
        ...notification,
        browserActions: available,
        candidate: {
          ...notification.candidate,
          start: model.calendar.now + (future ? 1 : 0),
        },
      });
      expect(
        fixture.latest().options.actions?.map((item) => item.action)
      ).toEqual(expected.slice(0, Math.min(slots, 2)));
      expect(fixture.plain).toHaveLength(0);
    })
);

it.effect(
  "granted connection warms registration and a successful explicit enable warms it again without waiting for readiness",
  () =>
    Effect.gen(function* warmRegistration() {
      const fixture = notificationBrowserFixture();
      const entered = yield* Queue.unbounded<true>();
      // @effect-diagnostics-next-line asyncFunction:off -- The test observes the browser registration Promise without running an Effect inside the native fake.
      fixture.register.mockImplementation(async () => {
        Queue.offerUnsafe(entered, true);
        await Promise.resolve();

        return fixture.registration;
      });
      const { notification } = workerContent();
      const { port } = yield* connect(notification.personId);
      yield* Queue.take(entered);
      expect(
        fixture.PlainNotification.requestPermission
      ).not.toHaveBeenCalled();
      expect(yield* port.requestPermission).toBe("granted");
      yield* Queue.take(entered);
      expect(fixture.PlainNotification.requestPermission).toHaveBeenCalledTimes(
        1
      );
      expect(fixture.registration.showNotification).not.toHaveBeenCalled();
    })
);

it.effect(
  "an installing registration takes the plain fallback immediately and registration refusal never changes observed permission",
  () =>
    Effect.gen(function* installingFallback() {
      const fixture = notificationBrowserFixture();
      Object.defineProperty(fixture.registration, "active", { value: null });
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);
      const { events, port } = yield* connect(notification.personId);
      yield* port.show(notification);
      expect(fixture.plain).toHaveLength(1);
      expect(fixture.registration.showNotification).not.toHaveBeenCalled();
      fixture.register.mockRejectedValue(new Error("Registration unavailable"));
      yield* port.show(notification);
      yield* expectNotificationPermissionBarrier(events, notification.personId);
      expect(fixture.PlainNotification.permission).toBe("granted");
    })
);

it.effect.each(["close", "permission", "expired"])(
  "a pending registration rechecks %s before either native display path",
  (change) =>
    Effect.gen(function* lateRegistration() {
      const fixture = notificationBrowserFixture();
      const gate = nativeNotificationGate();
      const entered = yield* Queue.unbounded<true>();
      // @effect-diagnostics-next-line asyncFunction:off -- A supplied native Promise controls registration completion while Effect owns the delivery actor.
      fixture.register.mockImplementation(async () => {
        Queue.offerUnsafe(entered, true);
        await gate.promise;

        return fixture.registration;
      });
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);
      const { port } = yield* connect(notification.personId);
      const delivery = yield* port.show(notification).pipe(Effect.forkScoped);
      yield* Queue.take(entered);
      yield* Queue.take(entered);

      if (change === "close") {
        yield* port.close(notification.personId, [notification.id]);
      }

      if (change === "permission") {
        fixture.PlainNotification.permission = "denied";
      }

      if (change === "expired") {
        yield* TestClock.setTime(notification.candidate.end);
      }

      gate.release();
      const outcome = yield* Fiber.join(delivery).pipe(Effect.result);
      expect(
        Result.isFailure(outcome),
        "Late inadmissible delivery must fail before display"
      ).toBe(true);

      if (Result.isFailure(outcome)) {
        expect(outcome.failure.reason).toBe(
          change === "close" ? "inactive" : change
        );
      }

      expect(fixture.registration.showNotification).not.toHaveBeenCalled();
      expect(fixture.plain).toHaveLength(0);
    })
);

it.effect(
  "closing an in-flight presentation closes its eventual native notification rather than leaking a late alert",
  () =>
    Effect.gen(function* lateShow() {
      const fixture = notificationBrowserFixture();
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);
      const gate = nativeNotificationGate();
      const entered = yield* Queue.unbounded<true>();

      const original = Option.getOrThrow(
        Option.fromUndefinedOr(
          fixture.registration.showNotification.getMockImplementation()
        )
      );

      fixture.registration.showNotification.mockImplementationOnce(
        // @effect-diagnostics-next-line asyncFunction:off -- Native show completion remains controllable after cancellation of the Effect delivery actor.
        async (title, options) => {
          Queue.offerUnsafe(entered, true);
          await gate.promise;
          await original(title, options);
        }
      );
      const { port } = yield* connect(notification.personId);
      const delivery = yield* port.show(notification).pipe(Effect.forkScoped);
      yield* Queue.take(entered);
      yield* port.close(notification.personId, [notification.id]);
      gate.release();
      const outcome = yield* Fiber.join(delivery).pipe(Effect.result);
      expect(
        Result.isFailure(outcome),
        "Closed in-flight delivery must not report a live presentation"
      ).toBe(true);

      if (Result.isFailure(outcome)) {
        expect(outcome.failure.reason).toBe("inactive");
      }

      expect(fixture.latest().closed).toBe(1);
      expect(fixture.plain).toHaveLength(0);
    })
);
