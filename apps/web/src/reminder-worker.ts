import { Option, Schema } from "effect";

import {
  WorkerMessage,
  WorkerReceipt,
} from "./client/reminders/worker-protocol.js";

interface ReminderWindowClient {
  readonly url: string;
  readonly type: string;
  readonly focus: () => Promise<ReminderWindowClient>;
  readonly postMessage: (message: typeof WorkerMessage.Type) => void;
}

interface ReminderWorkerEvent {
  readonly action: string;
  readonly notification: {
    readonly data: unknown;
    readonly tag: string;
    readonly close: () => void;
  };
  readonly waitUntil: (work: Promise<void>) => void;
}

interface ReminderWorkerScope {
  readonly location: { readonly origin: string };
  readonly clients: {
    readonly claim: () => Promise<void>;
    readonly matchAll: (options: {
      readonly type: "window";
      readonly includeUncontrolled: boolean;
    }) => Promise<readonly ReminderWindowClient[]>;
    readonly openWindow: (url: "/") => Promise<ReminderWindowClient | null>;
  };
  readonly skipWaiting: () => Promise<void>;
  readonly addEventListener: (
    name: "notificationclick" | "notificationclose" | "install" | "activate",
    handler: (event: ReminderWorkerEvent) => void
  ) => void;
}

declare const self: ReminderWorkerScope;

// @effect-diagnostics-next-line asyncFunction:off -- The browser owns service-worker event lifetime through waitUntil and native client Promises.
const routeNotification = async (
  event: ReminderWorkerEvent,
  closed: boolean
): Promise<void> => {
  const receipt = Schema.decodeUnknownOption(WorkerReceipt)(
    event.notification.data
  );

  if (Option.isNone(receipt) || event.notification.tag !== receipt.value.tag) {
    return;
  }

  const requested = event.action === "" ? "show" : event.action;

  const decoded = Schema.decodeUnknownOption(WorkerMessage)({
    ...receipt.value,
    action: closed ? "close" : requested,
  });

  if (Option.isNone(decoded)) {
    return;
  }

  const { value: message } = decoded;

  const windows = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });

  const client = windows.find(
    (candidate) =>
      candidate.type === "window" &&
      URL.canParse(candidate.url) &&
      new URL(candidate.url).origin === self.location.origin
  );

  if (client !== undefined) {
    let target = client;

    if (!closed) {
      try {
        target = await client.focus();
      } catch {
        target = client;
      }
    }

    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- WindowClient.postMessage has no targetOrigin parameter; the client is filtered to this origin.
    target.postMessage(message);
  } else if (!closed) {
    const opened = await self.clients.openWindow("/");

    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- WindowClient.postMessage has no targetOrigin parameter; only the same-origin root path is opened.
    opened?.postMessage({ ...message, action: "show" });
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(routeNotification(event, false));
});

self.addEventListener("notificationclose", (event) => {
  event.waitUntil(routeNotification(event, true));
});
