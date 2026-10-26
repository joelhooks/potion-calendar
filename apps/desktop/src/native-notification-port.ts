import { Effect } from "effect";
import { Notification } from "electron";

import { DesktopError } from "./config.js";
import type {
  NativeNotificationOptions,
  NativeNotificationSignal,
} from "./native-notifications.js";
import { bindNativeNotification } from "./notification-surface.js";

export const electronNotification = (
  options: NativeNotificationOptions,
  receive: (signal: NativeNotificationSignal) => void
) =>
  Effect.try({
    catch: (cause) =>
      new DesktopError({ cause, message: "Desktop notification unavailable" }),
    try: () => {
      const notification = new Notification({
        ...options,
        actions: options.actions.map((action) => ({
          text: action.text,
          type: "button",
        })),
      });

      return bindNativeNotification(
        {
          close: () => {
            notification.close();
          },
          onAction: (listener) => {
            notification.on("action", listener);
          },
          onClick: (listener) => {
            notification.on("click", listener);
          },
          onClose: (listener) => {
            notification.on("close", listener);
          },
          onFailed: (listener) => {
            notification.on("failed", listener);
          },
          onReply: (listener) => {
            notification.on("reply", listener);
          },
          onShow: (listener) => {
            notification.on("show", listener);
          },
          removeAllListeners: () => {
            notification.removeAllListeners();
          },
          show: () => {
            notification.show();
          },
        },
        receive
      );
    },
  });
