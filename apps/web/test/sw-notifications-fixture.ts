import { once } from "node:events";

import { expect } from "@effect/vitest";
import { Option, Schema } from "effect";
import { vi } from "vitest";

import { NotificationContent } from "../src/client/reminders/model.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

export const workerContent = (
  kind: Parameters<typeof reminderCardScene>[0] = "prompt"
) => {
  const scene = reminderCardScene(kind, "light", 1440);

  const command = scene.commands?.find(
    (item) => item.name === "DeliverReminderNotification"
  );

  if (command === undefined) {
    throw new Error("Missing real reminder delivery command");
  }

  const { notification } = Schema.decodeUnknownSync(
    Schema.Struct({ notification: NotificationContent })
  )(command.args);

  return { ...scene, notification };
};

export const nativeNotificationGate = () => {
  const emitter = new EventTarget();
  const promise = once(emitter, "release");

  return {
    promise,
    release: () => {
      emitter.dispatchEvent(new Event("release"));
    },
  };
};

export const notificationBrowserFixture = () => {
  const plain: PlainNotification[] = [];

  class PlainNotification extends EventTarget {
    static permission: NotificationPermission = "granted";
    static maxActions: number | undefined = 2;
    static readonly requestPermission = vi
      .fn<() => Promise<NotificationPermission>>()
      .mockResolvedValue("granted");
    readonly options: NotificationOptions;
    readonly title: string;
    closed = 0;
    constructor(title: string, options: NotificationOptions) {
      super();
      this.title = title;
      this.options = options;
      plain.push(this);
    }
    close() {
      this.closed += 1;
      this.dispatchEvent(new Event("close"));
    }
  }

  const active = new EventTarget();
  const container = new EventTarget();

  const presented: {
    readonly title: string;
    readonly data: unknown;
    readonly tag: string;
    readonly options: NotificationOptions & {
      readonly actions?: readonly {
        readonly action: string;
        readonly title: string;
      }[];
    };
    closed: number;
    close: () => void;
  }[] = [];

  const registration = {
    active,
    getNotifications: vi.fn(
      // @effect-diagnostics-next-line asyncFunction:off -- The browser registration fake exposes the native Promise API consumed by the Effect adapter.
      async ({ tag }: { readonly tag: string }) =>
        await Promise.resolve(
          presented.filter(
            (item) => item.options.tag === tag && item.closed === 0
          )
        )
    ),
    showNotification: vi.fn(
      // @effect-diagnostics-next-line asyncFunction:off -- The fake records native browser completion without running an Effect manually.
      async (title: string, options: NotificationOptions) => {
        const data: unknown = options.data;

        const notification = {
          close: () => {
            notification.closed += 1;
          },
          closed: 0,
          data,
          options,
          tag: options.tag ?? "",
          title,
        };

        for (const previous of presented) {
          if (previous.options.tag === options.tag) {
            previous.close();
          }
        }

        presented.push(notification);

        await Promise.resolve();
      }
    ),
  };

  const register = vi
    .fn<() => Promise<typeof registration>>()
    .mockResolvedValue(registration);

  Object.defineProperty(container, "register", { value: register });
  vi.stubGlobal("Notification", PlainNotification);
  vi.stubGlobal("navigator", { serviceWorker: container });

  const send = (message: MessageEventInit, source: EventTarget = active) => {
    const event = new MessageEvent("message", {
      origin: window.location.origin,
      ...message,
    });

    Object.defineProperty(event, "source", { value: source });
    container.dispatchEvent(event);
  };

  const latest = () => {
    expect(
      presented.length,
      "Worker display must reach registration.showNotification"
    ).toBeGreaterThan(0);

    return Option.getOrThrow(Option.fromUndefinedOr(presented.at(-1)));
  };

  return {
    PlainNotification,
    active,
    container,
    latest,
    plain,
    presented,
    register,
    registration,
    send,
  };
};
