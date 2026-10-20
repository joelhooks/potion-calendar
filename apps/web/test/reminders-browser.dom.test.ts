import { expect, it } from "@effect/vitest";
import { Effect, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";

import { browserNotifications } from "../src/client/reminders/browser.js";
import { NotificationEvent } from "../src/client/reminders/model.js";
import {
  reminderEpoch,
  scanReminders,
  startedReminders,
} from "./reminders-fixture.js";

const nativeFixture = () => {
  const created: NativeNotification[] = [];

  class NativeNotification extends EventTarget {
    static permission: NotificationPermission = "granted";
    static readonly requestPermission = vi
      .fn<() => Promise<NotificationPermission>>()
      .mockResolvedValue("granted");
    readonly title: string;
    readonly options: NotificationOptions;
    closed = 0;
    constructor(title: string, options: NotificationOptions) {
      super();
      this.title = title;
      this.options = options;
      created.push(this);
    }
    close() {
      this.closed += 1;
      this.dispatchEvent(new Event("close"));
    }
  }

  vi.stubGlobal("Notification", NativeNotification);

  return { NativeNotification, created };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.effect(
  "the browser adapter reads permission without prompting, forwards a native click, and closes once on scope exit",
  () =>
    Effect.gen(function* browserRecipient() {
      yield* TestClock.setTime(reminderEpoch + 50 * 60_000);
      const fixture = nativeFixture();

      const focus = vi
        .spyOn(window, "focus")
        .mockImplementation(vi.fn<() => void>());

      const port = browserNotifications();

      const [content] = scanReminders(startedReminders(), 50).context
        .deliveries;

      if (content === undefined) {
        return yield* Effect.die(new Error("Missing reminder fixture"));
      }

      const native = yield* Effect.gen(function* nativeScope() {
        const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
        yield* port.observe(content.personId).pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkScoped
        );
        const permission = yield* Queue.take(events);
        expect(permission).toEqual(
          NotificationEvent.cases.Permission.make({
            permission: "granted",
            personId: content.personId,
          })
        );
        expect(
          fixture.NativeNotification.requestPermission
        ).not.toHaveBeenCalled();
        yield* port.show(content);
        const [shown] = fixture.created;

        if (shown === undefined) {
          return yield* Effect.die(
            new Error("Native constructor was not called")
          );
        }

        expect(shown.title).toBe(content.title);
        expect(shown.options.body).toBe(content.candidate.body);
        shown.dispatchEvent(new Event("click"));
        expect(yield* Queue.take(events)).toEqual(
          NotificationEvent.cases.Clicked.make({ notification: content })
        );
        expect(focus).toHaveBeenCalledTimes(1);
        shown.dispatchEvent(new Event("error"));
        expect(yield* Queue.take(events)).toEqual(
          NotificationEvent.cases.Failed.make({
            id: content.id,
            personId: content.personId,
          })
        );

        return shown;
      }).pipe(Effect.scoped);

      expect(native.closed).toBe(1);
      native.dispatchEvent(new Event("click"));
      expect(focus).toHaveBeenCalledTimes(1);
      expect(
        fixture.NativeNotification.requestPermission
      ).not.toHaveBeenCalled();

      return yield* Effect.void;
    })
);

it.effect(
  "explicit browser permission requests retain their result and unsupported browsers never prompt",
  () =>
    Effect.gen(function* browserPermission() {
      const fixture = nativeFixture();
      const port = browserNotifications();
      expect(yield* port.requestPermission).toBe("granted");
      expect(
        fixture.NativeNotification.requestPermission
      ).toHaveBeenCalledTimes(1);
      vi.stubGlobal("Notification", globalThis.undefined);
      expect(yield* port.requestPermission).toBe("unsupported");
      const observed = yield* Stream.runHead(port.observe("fixture-person"));
      expect(Option.getOrUndefined(observed)).toEqual(
        NotificationEvent.cases.Permission.make({
          permission: "unsupported",
          personId: "fixture-person",
        })
      );
    })
);

it.effect(
  "the browser refuses disconnected-person and expired delivery before constructing a notification",
  () =>
    Effect.gen(function* browserAdmission() {
      const fixture = nativeFixture();
      const port = browserNotifications();

      const [content] = scanReminders(startedReminders(), 50).context
        .deliveries;

      if (content === undefined) {
        return yield* Effect.die(new Error("Missing reminder fixture"));
      }

      expect((yield* port.show(content).pipe(Effect.flip)).reason).toBe(
        "inactive"
      );
      yield* Effect.gen(function* expiredScope() {
        const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
        yield* port.observe(content.personId).pipe(
          Stream.runForEach((event) => Queue.offer(events, event)),
          Effect.forkScoped
        );
        yield* Queue.take(events);
        yield* TestClock.setTime(content.candidate.end);
        expect((yield* port.show(content).pipe(Effect.flip)).reason).toBe(
          "expired"
        );
      }).pipe(Effect.scoped);
      expect(fixture.created).toHaveLength(0);

      return yield* Effect.void;
    })
);
