import { Clock, Effect, Stream } from "effect";

import { Message } from "../message.js";
import type { NotificationEvent } from "./model.js";
import { NotificationPort } from "./port.js";

const observationMessage = Effect.fn("reminderObservationMessage")(
  function* observationMessage(event: typeof NotificationEvent.Type) {
    return Message.ObservedNotification({
      event,
      now: yield* Clock.currentTimeMillis,
    });
  }
);

export const reminderNotificationStream = (personId: string) =>
  Stream.unwrap(
    Effect.gen(function* notificationObserver() {
      const port = yield* NotificationPort;

      return port.observe(personId).pipe(Stream.mapEffect(observationMessage));
    })
  );
