import { expect, it } from "@effect/vitest";
import { Effect, Exit, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { browserNotifications } from "../src/client/reminders/browser.js";
import type { NotificationEvent } from "../src/client/reminders/model.js";
import { revealReminderSnooze } from "../src/client/reminders/snooze-surface.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.effect.each([
  { bottom: 420, expected: 160, top: 160 },
  { bottom: 200, expected: 10, top: 90 },
  { bottom: 250, expected: 20, top: 110 },
])(
  "an open disclosure at $top..$bottom scrolls only its reminder stack to $expected",
  (geometry) =>
    Effect.sync(() => {
      const stack = document.createElement("div");
      const disclosure = document.createElement("details");

      stack.className = "reminder-cards";
      disclosure.open = true;
      stack.append(disclosure);
      document.body.append(stack);
      Object.defineProperties(stack, {
        clientHeight: { value: 180 },
        clientTop: { value: 0 },
      });
      stack.scrollTop = 20;
      vi.spyOn(stack, "getBoundingClientRect").mockReturnValue(
        new DOMRect(20, 100, 340, 180)
      );
      vi.spyOn(disclosure, "getBoundingClientRect").mockReturnValue(
        new DOMRect(30, geometry.top, 320, geometry.bottom - geometry.top)
      );
      revealReminderSnooze(disclosure);
      expect(stack.scrollTop).toBe(geometry.expected);
      expect(document.documentElement.scrollTop).toBe(0);
    })
);

it.effect(
  "a closed disclosure does not move its stack and opening or closing never dismisses its card",
  () =>
    Effect.sync(() => {
      const stack = document.createElement("div");
      const disclosure = document.createElement("details");

      stack.className = "reminder-cards";
      stack.append(disclosure);
      stack.scrollTop = 10;
      revealReminderSnooze(disclosure);
      expect(stack.scrollTop).toBe(10);
      const { model } = reminderCardScene("reminder", "light", 390);
      const [notification] = model.reminders.context.active;

      if (notification === undefined) {
        throw new Error("Missing reminder fixture");
      }

      for (const open of [true, false]) {
        const result = update(
          model,
          Message.ReminderSnoozeDisclosureChanged({
            id: notification.id,
            open,
            personId: notification.personId,
          })
        );

        expect(result.model.reminders.context.active).toEqual(
          model.reminders.context.active
        );
        expect(
          (result.commands ?? []).filter(
            (command) => command.name === "RevealReminderSnooze"
          )
        ).toHaveLength(open ? 1 : 0);
        expect(
          (result.commands ?? []).filter(
            (command) => command.name === "CloseReminderNotifications"
          )
        ).toEqual([]);
      }
    })
);

it.effect(
  "an ended snoozed reminder still reaches the unchanged actionless browser Notification adapter",
  () =>
    Effect.gen(function* endedBrowserPopup() {
      const { model } = reminderCardScene("reminder", "light", 1440);
      const [original] = model.reminders.context.active;

      if (original === undefined) {
        return yield* Effect.die(new Error("Missing reminder fixture"));
      }

      const calls: NotificationOptions[] = [];

      class NativeNotification extends EventTarget {
        static permission = "granted";
        constructor(_title: string, options: NotificationOptions) {
          super();
          calls.push(options);
        }
        close() {
          this.dispatchEvent(new Event("close"));
        }
      }

      vi.stubGlobal("Notification", NativeNotification);
      yield* TestClock.setTime(original.candidate.end + 60_000);

      const notification = {
        ...original,
        card: {
          kind: "reminder" as const,
          snoozedUntil: original.candidate.end + 60_000,
          state: "active" as const,
        },
      };

      const port = browserNotifications();

      const observations =
        yield* Queue.unbounded<typeof NotificationEvent.Type>();

      yield* port.observe(original.personId).pipe(
        Stream.runForEach((event) => Queue.offer(observations, event)),
        Effect.forkScoped
      );
      yield* Queue.take(observations);
      const shown = yield* Effect.exit(port.show(notification));

      expect(Exit.isSuccess(shown)).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.body).toContain(original.candidate.body);
      expect(calls[0]).not.toHaveProperty("actions");
      yield* port.close(original.personId, [original.id]);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);
