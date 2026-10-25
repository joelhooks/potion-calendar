import { Clock, Effect, Option, Queue, Schema, Stream } from "effect";

import { NotificationEvent, NotificationFailure } from "./model.js";
import type {
  NotificationContentValue,
  NotificationPermission,
} from "./model.js";
import type { NotificationPortService } from "./port.js";
import { serviceWorkerNotifications } from "./worker-notifications.js";

const channel = "calendar-reminder-notification";

const warmChannel = "calendar-reminder-worker-register";

const handleKey = (personId: string, id: string) =>
  JSON.stringify([personId, id]);

const browserPermission = (): typeof NotificationPermission.Type =>
  typeof window === "undefined" || typeof Notification === "undefined"
    ? "unsupported"
    : Notification.permission;

export const browserNotifications = (): NotificationPortService => {
  const handles = new Map<
    string,
    { readonly personId: string; readonly notification: Notification }
  >();

  const connected = new Map<string, symbol>();

  const attempts = new Map<
    string,
    { readonly personId: string; readonly token: symbol }
  >();

  const worker = serviceWorkerNotifications((event) => {
    window.dispatchEvent(new CustomEvent(channel, { detail: event }));
  });

  const close = Effect.fn("BrowserNotifications.close")(function* close(
    personId: string,
    ids: readonly string[]
  ) {
    for (const id of ids) {
      attempts.delete(handleKey(personId, id));
    }

    yield* worker.close(personId, ids);
    yield* Effect.sync(() => {
      for (const id of ids) {
        const key = handleKey(personId, id);
        const handle = handles.get(key);
        handles.delete(key);
        handle?.notification.close();
      }
    });
  });

  const show = Effect.fn("BrowserNotifications.show")(function* show(
    content: NotificationContentValue
  ) {
    if (!connected.has(content.personId)) {
      return yield* new NotificationFailure({ reason: "inactive" });
    }

    if (browserPermission() !== "granted") {
      return yield* new NotificationFailure({ reason: "permission" });
    }

    if (
      content.card?.snoozedUntil === undefined &&
      content.candidate.end <= (yield* Clock.currentTimeMillis)
    ) {
      return yield* new NotificationFailure({ reason: "expired" });
    }

    const connection = connected.get(content.personId);
    const operationKey = handleKey(content.personId, content.id);
    const token = Symbol(content.id);
    attempts.set(operationKey, { personId: content.personId, token });

    const current = () =>
      connected.get(content.personId) === connection &&
      connection !== undefined &&
      attempts.get(operationKey)?.token === token;

    const shown = yield* worker.show(content, current);

    if (!current()) {
      return yield* new NotificationFailure({ reason: "inactive" });
    }

    if (shown) {
      const key = handleKey(content.personId, content.id);
      const old = handles.get(key);
      handles.delete(key);
      old?.notification.close();

      return yield* Effect.void;
    }

    yield* worker.close(content.personId, [content.id]);

    if (!current()) {
      return yield* new NotificationFailure({ reason: "inactive" });
    }

    if (browserPermission() !== "granted") {
      return yield* new NotificationFailure({ reason: "permission" });
    }

    if (
      content.card?.snoozedUntil === undefined &&
      content.candidate.end <= (yield* Clock.currentTimeMillis)
    ) {
      return yield* new NotificationFailure({ reason: "expired" });
    }

    yield* Effect.try({
      catch: () => new NotificationFailure({ reason: "delivery" }),
      try: () => {
        const native = new Notification(content.title, {
          body:
            content.card === undefined
              ? content.candidate.body
              : `${content.candidate.body}\nClick to open Calendar and view this card. Actions are available on the card in Calendar, not in this plain browser notification.`,
          tag: JSON.stringify([content.personId, content.candidate.identity]),
        });

        const key = handleKey(content.personId, content.id);
        handles.set(key, { notification: native, personId: content.personId });
        native.addEventListener("click", () => {
          if (
            connected.has(content.personId) &&
            (content.card === undefined ||
              handles.get(key)?.notification === native)
          ) {
            window.focus();
            window.dispatchEvent(
              new CustomEvent(channel, {
                detail: NotificationEvent.cases.Clicked.make({
                  notification: content,
                }),
              })
            );
          }
        });
        native.addEventListener("error", () => {
          if (content.card !== undefined) {
            if (handles.get(key)?.notification !== native) {
              return;
            }

            handles.delete(key);
          }

          native.close();
          window.dispatchEvent(
            new CustomEvent(channel, {
              detail: NotificationEvent.cases.Failed.make({
                id: content.id,
                personId: content.personId,
              }),
            })
          );
        });
        native.addEventListener("close", () => {
          if (handles.get(key)?.notification === native) {
            handles.delete(key);

            if (content.card !== undefined && connected.has(content.personId)) {
              window.dispatchEvent(
                new CustomEvent(channel, {
                  detail: NotificationEvent.cases.Closed.make({
                    id: content.id,
                    personId: content.personId,
                  }),
                })
              );
            }
          }
        });
      },
    });

    return yield* Effect.void;
  });

  return {
    close,
    observe: (personId) =>
      typeof window === "undefined"
        ? Stream.succeed(
            NotificationEvent.cases.Permission.make({
              permission: "unsupported",
              personId,
            })
          )
        : Stream.callback<typeof NotificationEvent.Type>((queue) => {
            const permission = () => {
              Queue.offerUnsafe(
                queue,
                NotificationEvent.cases.Permission.make({
                  permission: browserPermission(),
                  personId,
                })
              );
            };

            const receive = (event: Event) => {
              if (!(event instanceof CustomEvent)) {
                return;
              }

              const decoded = Schema.decodeUnknownOption(NotificationEvent)(
                event.detail
              );

              if (Option.isSome(decoded)) {
                const { value } = decoded;

                const owner = NotificationEvent.guards.Clicked(value)
                  ? value.notification.personId
                  : value.personId;

                if (owner === personId) {
                  Queue.offerUnsafe(queue, value);
                }
              }
            };

            const receiveWorker = worker.receive.bind(worker, personId);

            return Effect.gen(function* observeBrowserNotifications() {
              const registrations = yield* Queue.unbounded<true>();

              const warm = () => {
                if (browserPermission() === "granted") {
                  Queue.offerUnsafe(registrations, true);
                }
              };

              yield* Stream.fromQueue(registrations).pipe(
                Stream.runForEach(() => worker.prepare),
                Effect.forkScoped
              );

              const serviceWorkers =
                typeof navigator === "undefined"
                  ? undefined
                  : navigator.serviceWorker;

              return yield* Effect.acquireRelease(
                Effect.sync(() => {
                  connected.set(personId, Symbol(personId));
                  serviceWorkers?.addEventListener("message", receiveWorker);
                  window.addEventListener(channel, receive);
                  window.addEventListener("focus", permission);
                  window.addEventListener(warmChannel, warm);
                  permission();
                  warm();
                }),
                () =>
                  Effect.gen(function* releaseNotifications() {
                    connected.delete(personId);

                    for (const [key, attempt] of attempts) {
                      if (attempt.personId === personId) {
                        attempts.delete(key);
                      }
                    }

                    serviceWorkers?.removeEventListener(
                      "message",
                      receiveWorker
                    );
                    yield* worker.disconnect(personId);
                    window.removeEventListener(channel, receive);
                    window.removeEventListener("focus", permission);
                    window.removeEventListener(warmChannel, warm);

                    for (const [key, handle] of handles) {
                      if (handle.personId === personId) {
                        handle.notification.close();
                        handles.delete(key);
                      }
                    }
                  })
              ).pipe(Effect.andThen(Effect.never));
            });
          }),
    requestPermission: Effect.suspend(() =>
      typeof Notification === "undefined"
        ? Effect.succeed<typeof NotificationPermission.Type>("unsupported")
        : Effect.tryPromise({
            catch: () => new NotificationFailure({ reason: "permission" }),
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () => Notification.requestPermission(),
          })
    ).pipe(
      Effect.tap((permission) =>
        Effect.sync(() => {
          if (permission === "granted" && typeof window !== "undefined") {
            window.dispatchEvent(new Event(warmChannel));
          }
        })
      )
    ),
    show,
  };
};
