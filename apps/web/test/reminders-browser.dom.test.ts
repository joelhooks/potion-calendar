import { expect, it } from "@effect/vitest";
import { Effect, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { browserNotifications } from "../src/client/reminders/browser.js";
import { NotificationEvent } from "../src/client/reminders/model.js";
import { reminderCardScene } from "./reminder-card-fixture.js";
import {
  reminderEpoch,
  scanReminders,
  startedReminders,
} from "./reminders-fixture.js";
import { upcomingNow } from "./upcoming-fixture.js";

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

it.effect.each([false, true])(
  "native close preserves the actual card with or without a preceding click (%s)",
  (clicked) =>
    Effect.gen(function* nativeClosePolicy() {
      yield* TestClock.setTime(upcomingNow + 60_000);
      const fixture = nativeFixture();

      const focus = vi
        .spyOn(window, "focus")
        .mockImplementation(vi.fn<() => void>());

      let { model } = reminderCardScene("prompt", "light", 1440);
      const [content] = model.reminders.context.active;

      if (content === undefined) {
        return yield* Effect.die(new Error("Missing active card"));
      }

      const port = browserNotifications();
      const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
      yield* port.observe(content.personId).pipe(
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkScoped
      );
      yield* Queue.take(events);
      yield* port.show(content);
      const [native] = fixture.created;

      if (native === undefined) {
        return yield* Effect.die(new Error("Missing native presentation"));
      }

      if (clicked) {
        native.dispatchEvent(new Event("click"));
        const event = yield* Queue.take(events);
        expect(NotificationEvent.guards.Clicked(event)).toBe(true);
        ({ model } = update(
          model,
          Message.ObservedNotification({ event, now: model.calendar.now })
        ));
      }

      native.close();
      const closed = yield* Queue.take(events);
      expect(NotificationEvent.guards.Closed(closed)).toBe(true);

      const result = update(
        model,
        Message.ObservedNotification({ event: closed, now: model.calendar.now })
      );

      expect(
        result.model.reminders.context.active.map((item) => item.id)
      ).toEqual([content.id]);
      expect(result.commands ?? []).toEqual([]);
      expect(focus).toHaveBeenCalledTimes(clicked ? 1 : 0);
      yield* port.close(content.personId, [content.id]);
      expect(native.closed).toBe(1);

      return yield* Effect.void;
    })
);

it.effect(
  "managed native errors report failure without masquerading as a user dismissal",
  () =>
    Effect.gen(function* managedNativeError() {
      yield* TestClock.setTime(reminderEpoch + 50 * 60_000);
      const fixture = nativeFixture();
      const port = browserNotifications();

      const [content] = scanReminders(startedReminders(), 50, {
        webCards: true,
      }).context.deliveries;

      if (content === undefined) {
        return yield* Effect.die(new Error("Missing managed notification"));
      }

      const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
      yield* port.observe(content.personId).pipe(
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkScoped
      );
      yield* Queue.take(events);
      yield* port.show(content);
      fixture.created[0]?.dispatchEvent(new Event("error"));
      expect(yield* Queue.take(events)).toEqual(
        NotificationEvent.cases.Failed.make({
          id: content.id,
          personId: content.personId,
        })
      );
      expect(yield* Queue.poll(events)).toEqual(Option.none());
      expect(fixture.created[0]?.closed).toBe(1);
      yield* port.close(content.personId, [content.id]);
      expect(fixture.created[0]?.closed).toBe(1);

      return yield* Effect.void;
    })
);

it.effect(
  "a hidden tab retains exactly one plain Notification alongside the selected action card",
  () =>
    Effect.gen(function* hiddenTabReminder() {
      yield* TestClock.setTime(reminderEpoch + 50 * 60_000);
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      const fixture = nativeFixture();
      const port = browserNotifications();
      const state = scanReminders(startedReminders(), 50, { webCards: true });
      const [content] = state.context.deliveries;

      if (content === undefined) {
        return yield* Effect.die(new Error("Missing managed reminder fixture"));
      }

      const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
      yield* port.observe(content.personId).pipe(
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkScoped
      );
      yield* Queue.take(events);
      expect(state.context.active).toHaveLength(1);
      expect(content.card).toEqual({ kind: "reminder", state: "active" });
      yield* port.show(content);
      expect(fixture.created).toHaveLength(1);
      expect(fixture.created[0]?.title).toBe(
        `Reminder: ${content.candidate.title}`
      );
      expect(fixture.created[0]?.options.body).toContain(
        "not in this plain browser notification"
      );
      expect(fixture.created[0]?.options).not.toHaveProperty("actions");
      expect(
        scanReminders(state, 50, { webCards: true }).context.deliveries
      ).toEqual([]);
      expect(fixture.created).toHaveLength(1);
      fixture.created[0]?.close();
      expect(yield* Queue.take(events)).toEqual(
        NotificationEvent.cases.Closed.make({
          id: content.id,
          personId: content.personId,
        })
      );

      return yield* Effect.void;
    })
);
