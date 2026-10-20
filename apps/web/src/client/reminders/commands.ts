import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, createEffectLogic, join } from "@xstate/effect";
import { Clock, Effect, Option, Schema } from "effect";
import { Command } from "foldkit";

import { Message } from "../message.js";
import {
  NotificationContent,
  NotificationFailure,
  PermissionOutcome,
} from "./model.js";
import { NotificationPort } from "./port.js";

const permissionLogic = createEffectLogic({
  effect: Effect.gen(function* requestBrowserPermission() {
    const port = yield* NotificationPort;

    return yield* port.requestPermission.pipe(
      Effect.match({
        onFailure: (failure) =>
          PermissionOutcome.cases.Failed.make({ failure }),
        onSuccess: (permission) =>
          PermissionOutcome.cases.Observed.make({ permission }),
      })
    );
  }),
  schemas: { output: PermissionOutcome },
});

const deliveryLogic = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* deliverNotification() {
      const port = yield* NotificationPort;

      return yield* port.show(input).pipe(
        Effect.match({
          onFailure: Option.some,
          onSuccess: () => Option.none<NotificationFailure>(),
        })
      );
    }),
  schemas: {
    input: NotificationContent,
    output: Schema.Option(NotificationFailure),
  },
});

export const RequestReminderPermission = Command.define(
  "RequestReminderPermission",
  {
    args: { personId: Schema.String },
    execute: ({ personId }) =>
      Effect.gen(function* requestReminderPermission() {
        const actor = yield* createEffectActor(permissionLogic);
        yield* watchActor("calendar.reminders.permission", actor);
        const outcome = yield* join(actor).pipe(Effect.orDie);

        return Message.ReminderPermissionCompleted({
          now: yield* Clock.currentTimeMillis,
          outcome,
          personId,
        });
      }).pipe(Effect.scoped),
    messages: [Message.ReminderPermissionCompleted],
  }
);

export const DeliverReminderNotification = Command.define(
  "DeliverReminderNotification",
  {
    args: { notification: NotificationContent },
    execute: ({ notification }) =>
      Effect.gen(function* deliverReminderNotification() {
        const actor = yield* createEffectActor(deliveryLogic, {
          input: notification,
        });

        yield* watchActor("calendar.reminders.delivery", actor);
        const failure = yield* join(actor).pipe(Effect.orDie);

        return Message.ReminderDeliveryCompleted({
          failure,
          id: notification.id,
          personId: notification.personId,
        });
      }).pipe(Effect.scoped),
    messages: [Message.ReminderDeliveryCompleted],
  }
);

export const CloseReminderNotifications = Command.define(
  "CloseReminderNotifications",
  {
    args: { ids: Schema.Array(Schema.String), personId: Schema.String },
    execute: ({ ids, personId }) =>
      Effect.gen(function* closeReminderNotifications() {
        const port = yield* NotificationPort;
        yield* port.close(personId, ids);

        return Message.ReminderEffectCompleted();
      }),
    messages: [Message.ReminderEffectCompleted],
  }
);
