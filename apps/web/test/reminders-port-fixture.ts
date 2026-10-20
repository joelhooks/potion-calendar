import { Effect, Option, Queue, Stream } from "effect";

import {
  NotificationEvent,
  NotificationFailure,
} from "../src/client/reminders/model.js";
import type {
  NotificationContentValue,
  NotificationPermission,
} from "../src/client/reminders/model.js";
import type { NotificationPortService } from "../src/client/reminders/port.js";

const fakeHandleKey = (personId: string, id: string) =>
  JSON.stringify([personId, id]);

export const fakeNotificationPort = Effect.fn("fakeNotificationPort")(
  (permission: typeof NotificationPermission.Type = "default") =>
    Effect.sync(() => {
      const observers = new Map<
        string,
        Queue.Queue<typeof NotificationEvent.Type>
      >();

      const shown: NotificationContentValue[] = [];
      const attempts: NotificationContentValue[] = [];
      const closed: { readonly personId: string; readonly id: string }[] = [];
      const requests: string[] = [];
      const focused: string[] = [];
      const active = new Map<string, NotificationContentValue>();
      let currentPermission = permission;
      let refusal: Option.Option<NotificationFailure> = Option.none();

      const close = Effect.fn("FakeNotifications.close")(function* close(
        personId: string,
        ids: readonly string[]
      ) {
        yield* Effect.sync(() => {
          for (const id of ids) {
            closed.push({ id, personId });
            active.delete(fakeHandleKey(personId, id));
          }
        });
      });

      const port: NotificationPortService = {
        close,
        observe: (personId) =>
          Stream.unwrap(
            Effect.gen(function* observeFakeNotifications() {
              const queue =
                yield* Queue.unbounded<typeof NotificationEvent.Type>();

              observers.set(personId, queue);
              yield* Effect.addFinalizer(() =>
                Effect.gen(function* closeFakeNotifications() {
                  observers.delete(personId);
                  yield* close(
                    personId,
                    [...active.values()].flatMap((notification) =>
                      notification.personId === personId
                        ? [notification.id]
                        : []
                    )
                  );
                })
              );
              yield* Queue.offer(
                queue,
                NotificationEvent.cases.Permission.make({
                  permission: currentPermission,
                  personId,
                })
              );

              return Stream.fromQueue(queue);
            })
          ),
        requestPermission: Effect.sync(() => {
          requests.push("request");

          return currentPermission;
        }),
        show: (notification) =>
          Effect.gen(function* showFakeNotification() {
            attempts.push(notification);

            if (Option.isSome(refusal)) {
              return yield* refusal.value;
            }

            shown.push(notification);
            active.set(
              fakeHandleKey(notification.personId, notification.id),
              notification
            );

            return yield* Effect.void;
          }),
      };

      const emit = Effect.fn("FakeNotifications.emit")(function* emit(
        personId: string,
        event: typeof NotificationEvent.Type
      ) {
        const queue = observers.get(personId);

        if (queue === undefined) {
          return yield* Effect.die(new Error("No fake notification observer"));
        }

        yield* Queue.offer(queue, event);

        return yield* Effect.void;
      });

      return {
        active,
        attempts,
        click: (notification: NotificationContentValue) =>
          Effect.gen(function* clickFakeNotification() {
            focused.push(notification.personId);
            yield* emit(
              notification.personId,
              NotificationEvent.cases.Clicked.make({ notification })
            );
          }),
        closed,
        focused,
        port,
        refuseDelivery: (reason: NotificationFailure["reason"]) =>
          Effect.sync(() => {
            refusal = Option.some(new NotificationFailure({ reason }));
          }),
        requests,
        setPermission: (value: typeof NotificationPermission.Type) =>
          Effect.sync(() => {
            currentPermission = value;
          }),
        shown,
      };
    })
);
