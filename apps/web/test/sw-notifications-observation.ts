import { expect } from "@effect/vitest";
import { Effect, Queue } from "effect";

import { NotificationEvent } from "../src/client/reminders/model.js";

export const expectNotificationPermissionBarrier = Effect.fn(
  "test.notificationPermissionBarrier"
)(function* expectNotificationPermissionBarrier(
  events: Queue.Queue<typeof NotificationEvent.Type>,
  personId: string
) {
  window.dispatchEvent(new Event("focus"));
  expect(yield* Queue.take(events)).toEqual(
    NotificationEvent.cases.Permission.make({ permission: "granted", personId })
  );
});
