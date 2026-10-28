import { expect, it } from "@effect/vitest";
import { Effect, Option, Queue, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { UrlRequest } from "foldkit/navigation";
import { afterEach, vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { notificationActions } from "../src/client/reminders/browser-actions.js";
import { browserNotifications } from "../src/client/reminders/browser.js";
import {
  NotificationEvent,
  notificationTag,
} from "../src/client/reminders/model.js";
import {
  notificationBrowserFixture,
  workerContent,
} from "./sw-notifications-fixture.js";
import { expectNotificationPermissionBarrier } from "./sw-notifications-observation.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const observing = Effect.fn("test.observingWorkerNotifications")(
  function* observing(personId: string) {
    const port = browserNotifications();
    const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
    yield* port.observe(personId).pipe(
      Stream.runForEach((event) => Queue.offer(events, event)),
      Effect.forkScoped
    );
    yield* Queue.take(events);

    return { events, port };
  }
);

it.effect.prop(
  "generated notification slots preserve Join then Email then future-start priority with an absolute two-action ceiling",
  {
    email: Schema.Boolean,
    future: Schema.Boolean,
    join: Schema.Boolean,
    limit: Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 0 })),
    snooze: Schema.Boolean,
  },
  ({ email, future, join, limit, snooze }) =>
    Effect.sync(() => {
      const { notification } = workerContent();
      const available: ("join" | "email" | "start")[] = [];
      const expected: string[] = [];
      const expectedTitles: string[] = [];

      if (join) {
        available.push("join");
        expected.push("join");
        expectedTitles.push("Join");
      }

      if (email) {
        available.push("email");
        expected.push("email");
        expectedTitles.push("Email participants");
      }

      if (snooze) {
        available.push("start");

        if (future) {
          expected.push("start");
          expectedTitles.push("Snooze until start");
        }
      }

      const actual = notificationActions(
        { ...notification, browserActions: available },
        notification.candidate.start + (future ? -1 : 0),
        limit
      );

      expect(actual.map((item) => item.action)).toEqual(
        expected.slice(0, Math.min(limit, 2))
      );
      expect(actual.map((item) => item.title)).toEqual(
        expectedTitles.slice(0, Math.min(limit, 2))
      );
    })
);

it.effect.each([0, 1, 2, 7, undefined])(
  "the real delivery projection offers worker actions within browser slots without prompting (%s)",
  (maxActions) =>
    Effect.gen(function* workerDisplay() {
      const fixture = notificationBrowserFixture();
      fixture.PlainNotification.maxActions = maxActions;
      const { notification, model } = workerContent();
      expect(notification.browserActions).toEqual(["join", "email", "start"]);
      yield* TestClock.setTime(model.calendar.now);
      expect(fixture.register).not.toHaveBeenCalled();
      const { port } = yield* observing(notification.personId);
      yield* port.show(notification);
      expect(fixture.register).toHaveBeenCalledWith("/reminder-worker.js", {
        scope: "/",
        updateViaCache: "none",
      });
      expect(fixture.plain).toHaveLength(0);
      const shown = fixture.latest();
      expect(shown.options.actions?.map((item) => item.action)).toEqual(
        ["join", "email"].slice(0, Math.min(maxActions ?? 2, 2))
      );
      expect(shown.options.tag).toBe(
        notificationTag(notification.personId, notification.candidate.identity)
      );
      expect(shown.options.silent).toBe(false);

      if (maxActions !== 0) {
        expect(shown.options.body).not.toContain(
          "Actions are available on the card"
        );
      }

      expect(
        fixture.PlainNotification.requestPermission
      ).not.toHaveBeenCalled();
    })
);

it.effect.each(["register", "query", "show"])(
  "a worker %s failure falls back to the existing plain notification body and click behavior",
  (failure) =>
    Effect.gen(function* workerFallback() {
      const fixture = notificationBrowserFixture();
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);

      if (failure === "register") {
        fixture.register.mockRejectedValue(new Error("register refused"));
      }

      if (failure === "query") {
        fixture.registration.getNotifications.mockRejectedValueOnce(
          new Error("query refused")
        );
      }

      if (failure === "show") {
        fixture.registration.showNotification.mockRejectedValueOnce(
          new Error("show refused")
        );
      }

      const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
      const { events, port } = yield* observing(notification.personId);
      yield* port.show(notification);
      expect(fixture.plain).toHaveLength(1);
      const plain = Option.getOrThrow(Option.fromUndefinedOr(fixture.plain[0]));
      expect(plain.options.body).toBe(
        `${notification.candidate.body}\nClick to open Calendar and view this card. Actions are available on the card in Calendar, not in this plain browser notification.`
      );
      plain.dispatchEvent(new Event("click"));
      expect(yield* Queue.take(events)).toEqual(
        NotificationEvent.cases.Clicked.make({ notification })
      );
      expect(focus).toHaveBeenCalledTimes(1);
      expect(
        fixture.PlainNotification.requestPermission
      ).not.toHaveBeenCalled();
    })
);

it.effect.each(["unsupported", "denied", "default", "desktop"])(
  "worker registration remains absent for %s",
  (reason) =>
    Effect.gen(function* workerAdmission() {
      const fixture = notificationBrowserFixture();
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);

      if (reason === "unsupported") {
        vi.stubGlobal("navigator", {});
      }

      if (reason === "desktop") {
        vi.stubGlobal("potionDesktop", {});
      }

      if (reason === "denied" || reason === "default") {
        fixture.PlainNotification.permission = reason;
      }

      const { port } = yield* observing(notification.personId);

      const content =
        reason === "desktop"
          ? { ...notification, browserActions: undefined }
          : notification;

      if (reason === "denied" || reason === "default") {
        expect((yield* port.show(content).pipe(Effect.flip)).reason).toBe(
          "permission"
        );
      } else {
        yield* port.show(content);
        expect(fixture.plain).toHaveLength(1);
      }

      expect(fixture.register).not.toHaveBeenCalled();
      expect(
        fixture.PlainNotification.requestPermission
      ).not.toHaveBeenCalled();
    })
);

it.effect.each(["show", "join", "email", "start"] as const)(
  "a posted %s traverses the actual port stream and root into the existing revalidating action",
  (action) =>
    Effect.gen(function* workerRecipient() {
      const fixture = notificationBrowserFixture();
      const scene = workerContent();
      const notification = { ...scene.notification, browserActions: [action] };
      yield* TestClock.setTime(scene.model.calendar.now);
      const { events, port } = yield* observing(notification.personId);
      yield* port.show(notification);

      const receipt = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          channel: Schema.String,
          id: Schema.String,
          receipt: Schema.String,
          tag: Schema.String,
        })
      )(fixture.latest().options.data);

      fixture.send({ data: { ...receipt, action } });
      const event = yield* Queue.take(events);
      expect(NotificationEvent.guards.Action(event)).toBe(true);

      const result = update(
        scene.model,
        Message.ObservedNotification({ event, now: scene.model.calendar.now })
      );

      if (action === "show") {
        expect(result.model.calendar.selected).not.toHaveLength(0);
      } else if (action === "join") {
        expect(
          result.commands?.some((command) => command.name === "JoinMeeting")
        ).toBe(true);
      } else if (action === "email") {
        const command = result.commands?.find(
          (item) => item.name === "FollowRouteRequest"
        );

        expect(command?.args).toEqual({
          request: UrlRequest.External({
            href: "mailto:guest@example.test?subject=Weekly%20project%20review",
          }),
        });
      } else {
        expect(
          result.commands?.some(
            (command) => command.name === "SampleReminderSnoozeClock"
          )
        ).toBe(true);
        expect(result.model.reminders.context.snoozeStorage?._tag).toBe(
          "Sampling"
        );
      }

      const stale = {
        ...scene.model,
        reminders: {
          ...scene.model.reminders,
          context: { ...scene.model.reminders.context, active: [] },
        },
      };

      expect(
        update(
          stale,
          Message.ObservedNotification({ event, now: stale.calendar.now })
        ).commands ?? []
      ).toEqual([]);
      const signedOut = { ...scene.model, person: Option.none<string>() };
      expect(
        update(
          signedOut,
          Message.ObservedNotification({ event, now: signedOut.calendar.now })
        ).model
      ).toBe(signedOut);
    })
);

it.effect(
  "mismatched routing receipts, origins, workers, ids, tags and unoffered actions cannot reach the root",
  () =>
    Effect.gen(function* staleWorkerMessage() {
      const fixture = notificationBrowserFixture();
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);
      const { events, port } = yield* observing(notification.personId);
      yield* port.show({ ...notification, browserActions: ["join"] });

      const receipt = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          channel: Schema.String,
          id: Schema.String,
          receipt: Schema.String,
          tag: Schema.String,
        })
      )(fixture.latest().options.data);

      const invalid = [
        null,
        {},
        { ...receipt, action: "provider-write" },
        { ...receipt, action: "join", tag: "wrong" },
        { ...receipt, action: "join", id: "old" },
        { ...receipt, action: "join", receipt: "old" },
        { ...receipt, action: "email" },
      ];

      for (const data of invalid) {
        fixture.send({ data });
      }

      fixture.send({
        data: { ...receipt, action: "join" },
        origin: "https://elsewhere.example",
      });
      fixture.send(
        {
          data: { ...receipt, action: "join" },
          origin: window.location.origin,
        },
        new EventTarget()
      );
      yield* expectNotificationPermissionBarrier(events, notification.personId);
      yield* port.close(notification.personId, [notification.id]);
      fixture.send({ data: { ...receipt, action: "show" } });
      yield* expectNotificationPermissionBarrier(events, notification.personId);
    })
);

it.effect(
  "silent replacement retires old presentation receipts and explicit closure queries only its stable tag",
  () =>
    Effect.gen(function* workerReplacement() {
      const fixture = notificationBrowserFixture();
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);
      const { events, port } = yield* observing(notification.personId);
      yield* port.show(notification);
      const first = fixture.latest();
      yield* port.show(notification);
      const second = fixture.latest();
      expect(second.options.silent).toBe(true);

      const data = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          channel: Schema.String,
          id: Schema.String,
          receipt: Schema.String,
          tag: Schema.String,
        })
      )(first.options.data);

      fixture.send({ data: { ...data, action: "show" } });
      yield* expectNotificationPermissionBarrier(events, notification.personId);
      fixture.registration.getNotifications.mockClear();
      yield* port.close(notification.personId, [notification.id]);
      expect(fixture.registration.getNotifications).toHaveBeenCalledWith({
        tag: notificationTag(
          notification.personId,
          notification.candidate.identity
        ),
      });
      expect(second.closed).toBe(1);
      expect(fixture.plain).toHaveLength(0);
    })
);

it.effect(
  "worker close preserves the active card and scope release removes the listener and closes the presentation",
  () =>
    Effect.gen(function* workerScope() {
      const fixture = notificationBrowserFixture();
      const { notification, model } = workerContent();
      yield* TestClock.setTime(model.calendar.now);
      const removed = vi.spyOn(fixture.container, "removeEventListener");
      yield* Effect.gen(function* workerClose() {
        const { events, port } = yield* observing(notification.personId);
        yield* port.show(notification);

        const data = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            channel: Schema.String,
            id: Schema.String,
            receipt: Schema.String,
            tag: Schema.String,
          })
        )(fixture.latest().options.data);

        fixture.send({ data: { ...data, action: "show" } });
        const clicked = yield* Queue.take(events);

        const selected = update(
          model,
          Message.ObservedNotification({
            event: clicked,
            now: model.calendar.now,
          })
        );

        expect(selected.model.calendar.selected).toEqual([
          notification.candidate.key,
        ]);
        expect(selected.model.reminders).toBe(model.reminders);

        const repeated = update(
          selected.model,
          Message.ObservedNotification({
            event: clicked,
            now: model.calendar.now,
          })
        );

        expect(repeated.model).toBe(selected.model);
        expect(repeated.commands ?? []).toEqual([]);

        fixture.send({ data: { ...data, action: "close" } });
        const event = yield* Queue.take(events);
        expect(NotificationEvent.guards.Closed(event)).toBe(true);
        expect(
          update(
            model,
            Message.ObservedNotification({ event, now: model.calendar.now })
          ).model
        ).toBe(model);
        yield* port.show(notification);
      }).pipe(Effect.scoped);
      expect(fixture.latest().closed).toBe(1);
      expect(removed).toHaveBeenCalledWith("message", expect.any(Function));
    })
);
