import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import { Clock, Crypto, Effect, Option, Schema } from "effect";

import { notificationActions } from "./browser-actions.js";
import {
  NotificationEvent,
  NotificationFailure,
  notificationTag,
} from "./model.js";
import type { NotificationContentValue } from "./model.js";
import { WorkerMessage, WorkerReceipt } from "./worker-protocol.js";

interface WorkerHandle {
  readonly content: NotificationContentValue;
  readonly registration: ServiceWorkerRegistration;
  readonly data: typeof WorkerReceipt.Type;
  readonly actions: readonly {
    readonly action: string;
    readonly title: string;
  }[];
  readonly current: () => boolean;
}

const deliveryFailure = () => new NotificationFailure({ reason: "delivery" });

const key = (personId: string, id: string) => JSON.stringify([personId, id]);

const closeOwnedNotifications = (
  notifications: readonly Notification[],
  receipt: typeof WorkerReceipt.Type
) => {
  for (const notification of notifications) {
    const data = Schema.decodeUnknownOption(WorkerReceipt)(notification.data);

    if (Option.isSome(data) && data.value.receipt === receipt.receipt) {
      notification.close();
    }
  }
};

export const serviceWorkerNotifications = (
  emit: (event: typeof NotificationEvent.Type) => void
) => {
  const handles = new Map<string, WorkerHandle>();
  let knownRegistration = Option.none<ServiceWorkerRegistration>();

  const closeHandle = Effect.fn("ServiceWorkerNotifications.closeHandle")(
    function* closeHandle(handle: WorkerHandle) {
      const notifications = yield* Effect.tryPromise({
        catch: deliveryFailure,
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          handle.registration.getNotifications({ tag: handle.data.tag }),
      });

      closeOwnedNotifications(notifications, handle.data);
    },
    Effect.catchTag("NotificationFailure", () => Effect.void)
  );

  const close = Effect.fn("ServiceWorkerNotifications.close")(function* close(
    personId: string,
    ids: readonly string[]
  ) {
    for (const id of ids) {
      const idKey = key(personId, id);
      const handle = handles.get(idKey);
      handles.delete(idKey);

      if (handle !== undefined) {
        yield* closeHandle(handle);
      }
    }
  });

  const register = Effect.fn("ServiceWorkerNotifications.register")(
    function* register() {
      if (
        typeof window === "undefined" ||
        window.potionDesktop !== undefined ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted" ||
        typeof navigator === "undefined" ||
        navigator.serviceWorker === undefined
      ) {
        knownRegistration = Option.none();

        return knownRegistration;
      }

      return yield* Effect.tryPromise({
        catch: deliveryFailure,
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          navigator.serviceWorker.register("/reminder-worker.js", {
            scope: "/",
            updateViaCache: "none",
          }),
      }).pipe(
        Effect.map((registration) => {
          knownRegistration = Option.some(registration);

          return knownRegistration;
        })
      );
    },
    Effect.catchTag("NotificationFailure", () =>
      Effect.logDebug(
        "Reminder notification worker registration unavailable"
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            knownRegistration = Option.none();

            return knownRegistration;
          })
        )
      )
    )
  );

  const show = Effect.fn("ServiceWorkerNotifications.show")(
    function* show(content: NotificationContentValue, current: () => boolean) {
      if (
        content.browserActions === undefined ||
        typeof window === "undefined" ||
        window.potionDesktop !== undefined
      ) {
        return false;
      }

      const registered =
        Option.isSome(knownRegistration) &&
        knownRegistration.value.active !== null
          ? knownRegistration
          : yield* register();

      if (Option.isNone(registered)) {
        return false;
      }

      const { value: registration } = registered;

      if (
        registration.active === null ||
        !current() ||
        Notification.permission !== "granted"
      ) {
        return false;
      }

      const crypto = yield* Crypto.Crypto;

      const data = WorkerReceipt.make({
        channel: "calendar-reminder-worker",
        id: content.id,
        receipt: yield* crypto.randomUUIDv4,
        tag: notificationTag(content.personId, content.candidate.identity),
      });

      const existing = yield* Effect.tryPromise({
        catch: deliveryFailure,
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => registration.getNotifications({ tag: data.tag }),
      });

      const now = yield* Clock.currentTimeMillis;

      if (
        !current() ||
        Notification.permission !== "granted" ||
        (content.card?.snoozedUntil === undefined &&
          content.candidate.end <= now)
      ) {
        return false;
      }

      // SAFETY: The optional platform property remains unknown until the Schema below decodes its value.
      const capabilities = Notification as typeof Notification & {
        readonly maxActions?: unknown;
      };

      const max = Schema.decodeUnknownOption(
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
      )(capabilities.maxActions);

      const actions = notificationActions(
        content,
        now,
        Option.getOrElse(max, () => 2)
      );

      const options = {
        actions,
        body:
          actions.length > 0 || content.card === undefined
            ? content.candidate.body
            : `${content.candidate.body}\nClick to open Calendar and view this card. Actions are available on the card in Calendar, not in this plain browser notification.`,
        data,
        silent: existing.length > 0,
        tag: data.tag,
      };

      const handle = { actions, content, current, data, registration };
      yield* Effect.tryPromise({
        catch: deliveryFailure,
        // @effect-diagnostics-next-line asyncFunction:off -- Native notification completion closes a cancelled presentation after the Effect actor stops.
        try: async (signal) => {
          await registration.showNotification(content.title, options);

          if (signal.aborted || !current()) {
            closeOwnedNotifications(
              await registration.getNotifications({ tag: data.tag }),
              data
            );
          }
        },
      });

      if (!current()) {
        yield* closeHandle(handle);

        return true;
      }

      for (const [idKey, previous] of handles) {
        if (previous.data.tag === data.tag) {
          handles.delete(idKey);
        }
      }

      handles.set(key(content.personId, content.id), handle);

      return true;
    },
    Effect.provide(BrowserCrypto.layer),
    Effect.match({ onFailure: () => false, onSuccess: (shown) => shown })
  );

  return {
    close,
    disconnect: (personId: string) =>
      close(
        personId,
        [...handles.values()].flatMap((handle) =>
          handle.content.personId === personId ? [handle.content.id] : []
        )
      ),
    prepare: register().pipe(Effect.asVoid),
    receive: (personId: string, event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const message = Schema.decodeUnknownOption(WorkerMessage)(event.data);

      if (Option.isNone(message)) {
        return;
      }

      const { value } = message;
      const handle = handles.get(key(personId, value.id));

      if (
        handle === undefined ||
        !handle.current() ||
        event.source !== handle.registration.active ||
        value.tag !== handle.data.tag ||
        value.receipt !== handle.data.receipt
      ) {
        return;
      }

      if (value.action === "close") {
        handles.delete(key(personId, value.id));
        emit(NotificationEvent.cases.Closed.make({ id: value.id, personId }));
      } else if (
        value.action === "show" ||
        handle.actions.some((action) => action.action === value.action)
      ) {
        emit(
          NotificationEvent.cases.Action.make({
            action: value.action,
            id: value.id,
            personId,
            tag: value.tag,
          })
        );
      }
    },
    show,
  };
};
