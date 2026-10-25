import { runInNewContext } from "node:vm";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import type { Mock } from "vitest";

import type { WorkerMessage } from "../src/client/reminders/worker-protocol.js";
import { reminderWorkerSource } from "./sw-notification-source.js";

const workerFixture = Effect.fn("test.notificationWorkerFixture")(
  function* workerFixture() {
    const code = yield* reminderWorkerSource;
    const tag = '["person","event"]';

    const data = {
      channel: "calendar-reminder-worker",
      id: "reminder-id",
      receipt: "presentation-receipt",
      tag,
    };

    interface EventValue {
      readonly action: string;
      readonly notification: {
        readonly data: typeof data;
        readonly tag: string;
        readonly close: () => void;
      };
      readonly waitUntil: (promise: Promise<void>) => void;
    }

    const handlers = new Map<string, (event: EventValue) => void>();

    interface FakeClient {
      readonly focus: Mock<() => Promise<FakeClient>>;
      readonly postMessage: Mock<(value: typeof WorkerMessage.Type) => void>;
      readonly type: string;
      readonly url: string;
    }

    const newest: FakeClient = {
      focus: vi.fn<() => Promise<FakeClient>>(),
      postMessage: vi.fn<(value: typeof WorkerMessage.Type) => void>(),
      type: "window",
      url: "https://calendar.example.test/settings/general",
    };

    const older: FakeClient = {
      focus: vi.fn<() => Promise<FakeClient>>(),
      postMessage: vi.fn<(value: typeof WorkerMessage.Type) => void>(),
      type: "window",
      url: "https://calendar.example.test/",
    };

    const foreign: FakeClient = {
      focus: vi.fn<() => Promise<FakeClient>>(),
      postMessage: vi.fn<(value: typeof WorkerMessage.Type) => void>(),
      type: "window",
      url: "https://elsewhere.example/",
    };

    for (const client of [newest, older, foreign]) {
      client.focus.mockResolvedValue(client);
    }

    const opened = {
      postMessage: vi.fn<(value: typeof WorkerMessage.Type) => void>(),
    };

    const clients = {
      claim: vi.fn<() => Promise<void>>().mockResolvedValue(),
      matchAll: vi
        .fn<() => Promise<FakeClient[]>>()
        .mockResolvedValue([foreign, newest, older]),
      openWindow: vi
        .fn<() => Promise<typeof opened | null>>()
        .mockResolvedValue(opened),
    };

    const skipWaiting = vi.fn<() => Promise<void>>().mockResolvedValue();

    runInNewContext(code, {
      URL,
      self: {
        addEventListener: (
          name: string,
          handler: (event: EventValue) => void
        ) => {
          handlers.set(name, handler);
        },
        clients,
        location: { origin: "https://calendar.example.test" },
        skipWaiting,
      },
    });
    const close = vi.fn<() => void>();

    const run = Effect.fn("test.notificationWorkerHandler")(function* run(
      name: string,
      action: EventValue["action"] = "",
      receipt: typeof data = data
    ) {
      const handler = handlers.get(name);

      if (handler === undefined) {
        return yield* Effect.die(new Error(`Missing worker handler: ${name}`));
      }

      const promises: Promise<void>[] = [];
      handler({
        action,
        notification: { close, data: receipt, tag },
        waitUntil: (promise) => {
          promises.push(promise);
        },
      });

      return yield* Effect.promise(Promise.all.bind(Promise, promises)).pipe(
        Effect.asVoid
      );
    });

    return {
      clients,
      close,
      data,
      foreign,
      handlers,
      newest,
      older,
      opened,
      run,
      skipWaiting,
    };
  }
);

it.effect.each(["", "join", "email", "start"])(
  "worker click %s focuses only the newest same-origin window and posts opaque routing data",
  (action) =>
    Effect.gen(function* workerClick() {
      const fixture = yield* workerFixture();
      yield* fixture.run("notificationclick", action);
      expect(fixture.clients.matchAll).toHaveBeenCalledWith({
        includeUncontrolled: true,
        type: "window",
      });
      expect(fixture.newest.focus).toHaveBeenCalledTimes(1);
      expect(fixture.newest.postMessage).toHaveBeenCalledWith({
        ...fixture.data,
        action: action || "show",
      });
      expect(fixture.foreign.focus).not.toHaveBeenCalled();
      expect(fixture.older.focus).not.toHaveBeenCalled();
      expect(fixture.clients.openWindow).not.toHaveBeenCalled();
      expect(fixture.close).toHaveBeenCalledTimes(1);
    })
);

it.effect.each(["join", "email", "start", ""])(
  "with no client, worker action %s opens only root and becomes Show",
  (action) =>
    Effect.gen(function* noWindow() {
      const fixture = yield* workerFixture();
      fixture.clients.matchAll.mockResolvedValue([fixture.foreign]);
      yield* fixture.run("notificationclick", action);
      expect(fixture.clients.openWindow).toHaveBeenCalledWith("/");
      expect(fixture.opened.postMessage).toHaveBeenCalledWith({
        ...fixture.data,
        action: "show",
      });
      expect(fixture.newest.focus).not.toHaveBeenCalled();
    })
);

it.effect(
  "closing a notification posts Close without focusing or opening a window",
  () =>
    Effect.gen(function* workerClose() {
      const fixture = yield* workerFixture();
      yield* fixture.run("notificationclose");
      expect(fixture.newest.postMessage).toHaveBeenCalledWith({
        ...fixture.data,
        action: "close",
      });
      expect(fixture.newest.focus).not.toHaveBeenCalled();
      fixture.clients.matchAll.mockResolvedValue([]);
      yield* fixture.run("notificationclose");
      expect(fixture.clients.openWindow).not.toHaveBeenCalled();
    })
);

it.effect(
  "the notifications-only worker claims clients and skips waiting without registering a fetch or cache handler",
  () =>
    Effect.gen(function* notificationOnly() {
      const fixture = yield* workerFixture();
      expect([...fixture.handlers.keys()].toSorted()).toEqual([
        "activate",
        "install",
        "notificationclick",
        "notificationclose",
      ]);
      yield* fixture.run("install");
      yield* fixture.run("activate");
      expect(fixture.skipWaiting).toHaveBeenCalledTimes(1);
      expect(fixture.clients.claim).toHaveBeenCalledTimes(1);
    })
);

it.effect(
  "mismatched worker routing data does not focus or open and a focus rejection still delivers to the existing client",
  () =>
    Effect.gen(function* workerRefusal() {
      const fixture = yield* workerFixture();
      yield* fixture.run("notificationclick", "join", {
        ...fixture.data,
        tag: "different",
      });
      expect(fixture.clients.matchAll).not.toHaveBeenCalled();
      fixture.newest.focus.mockRejectedValueOnce(
        new Error("Focus unavailable")
      );
      yield* fixture.run("notificationclick", "join");
      expect(fixture.newest.postMessage).toHaveBeenCalledWith({
        ...fixture.data,
        action: "join",
      });
      expect(fixture.clients.openWindow).not.toHaveBeenCalled();
    })
);
