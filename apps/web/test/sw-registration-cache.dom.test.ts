import { expect, it } from "@effect/vitest";
import { Effect, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";

import { browserNotifications } from "../src/client/reminders/browser.js";
import type { NotificationEvent } from "../src/client/reminders/model.js";
import {
  notificationBrowserFixture,
  workerContent,
} from "./sw-notifications-fixture.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.effect(
  "an already active registration displays without another script update request",
  () =>
    Effect.gen(function* activeRegistration() {
      const fixture = notificationBrowserFixture();
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);
      const port = browserNotifications();
      const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
      yield* port.observe(notification.personId).pipe(
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkScoped
      );
      yield* Queue.take(events);
      yield* port.show(notification);
      const registrations = fixture.register.mock.calls.length;
      fixture.register.mockRejectedValue(
        new Error(
          "A new network registration request must not delay an active display"
        )
      );
      yield* port.show(notification);
      expect(fixture.register).toHaveBeenCalledTimes(registrations);
      expect(fixture.presented).toHaveLength(2);
      expect(fixture.latest().options.silent).toBe(true);
      expect(fixture.plain).toHaveLength(0);
    })
);
