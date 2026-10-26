import { Effect } from "effect";

import { DesktopError } from "./config.js";
import type { NativeNotificationSignal } from "./native-notifications.js";

export interface NotificationActionEvent {
  readonly actionIndex?: number;
}

export interface NotificationSurface {
  readonly close: () => void;
  readonly onAction: (
    receive: (event: NotificationActionEvent, index: number) => void
  ) => void;
  readonly onClick: (receive: () => void) => void;
  readonly onClose: (receive: () => void) => void;
  readonly onFailed: (receive: () => void) => void;
  readonly onReply: (receive: () => void) => void;
  readonly onShow: (receive: () => void) => void;
  readonly removeAllListeners: () => void;
  readonly show: () => void;
}

export const bindNativeNotification = (
  notification: NotificationSurface,
  receive: (signal: NativeNotificationSignal) => void
) => {
  notification.onShow(() => {
    receive({ kind: "show" });
  });
  notification.onFailed(() => {
    receive({ kind: "failed" });
  });
  notification.onClick(() => {
    receive({ kind: "click" });
  });
  notification.onClose(() => {
    receive({ kind: "close" });
  });
  notification.onReply(() => {
    receive({ kind: "reply" });
  });
  notification.onAction((event, index) => {
    receive({ index: event.actionIndex ?? index, kind: "action" });
  });

  return {
    close: Effect.sync(() => {
      notification.removeAllListeners();
      notification.close();
    }),
    show: Effect.try({
      catch: (cause) =>
        new DesktopError({
          cause,
          message: "Desktop notification could not be shown",
        }),
      try: () => {
        notification.show();
      },
    }),
  };
};
