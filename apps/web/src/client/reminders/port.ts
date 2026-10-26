import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type {
  NotificationContentValue,
  NotificationEvent,
  NotificationFailure,
  NotificationPermission,
} from "./model.js";
import { routedNotifications } from "./native.js";

export interface NotificationPortService {
  readonly requestPermission: Effect.Effect<
    typeof NotificationPermission.Type,
    NotificationFailure
  >;
  readonly show: (
    notification: NotificationContentValue
  ) => Effect.Effect<void, NotificationFailure>;
  readonly close: (
    personId: string,
    ids: readonly string[]
  ) => Effect.Effect<void>;
  readonly observe: (
    personId: string
  ) => Stream.Stream<typeof NotificationEvent.Type>;
}

export const NotificationPort = Context.Reference<NotificationPortService>(
  "@calendar/web/reminders/NotificationPort",
  { defaultValue: routedNotifications }
);
