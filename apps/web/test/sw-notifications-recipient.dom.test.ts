import { MeetingJoinOutcome } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Queue, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { AsyncData } from "foldkit";
import { UrlRequest } from "foldkit/navigation";
import { afterEach, vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { JoinMeeting } from "../src/client/meetings/commands.js";
import { JoinSelection } from "../src/client/meetings/model.js";
import { MeetingPort } from "../src/client/meetings/port.js";
import { browserNotifications } from "../src/client/reminders/browser.js";
import {
  NotificationEvent,
  ReminderSnoozeChoice,
} from "../src/client/reminders/model.js";
import type { ReminderNotificationAction } from "../src/client/reminders/model.js";
import { SampleReminderSnoozeClock } from "../src/client/reminders/snooze-commands.js";
import { WorkerReceipt } from "../src/client/reminders/worker-protocol.js";
import {
  notificationBrowserFixture,
  workerContent,
} from "./sw-notifications-fixture.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const postedAction = Effect.fn("test.postedReminderAction")(
  function* postedAction(action: typeof ReminderNotificationAction.Type) {
    const fixture = notificationBrowserFixture();
    const scene = workerContent(action === "start" ? "reminder" : "prompt");
    yield* TestClock.setTime(scene.model.calendar.now);
    const port = browserNotifications();
    const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
    yield* port.observe(scene.notification.personId).pipe(
      Stream.runForEach((event) => Queue.offer(events, event)),
      Effect.forkScoped
    );
    yield* Queue.take(events);
    yield* port.show(scene.notification);

    const receipt = yield* Schema.decodeUnknownEffect(WorkerReceipt)(
      fixture.latest().options.data
    );

    fixture.send({ data: { ...receipt, action } });

    const event = yield* Schema.decodeUnknownEffect(
      NotificationEvent.cases.Action
    )(yield* Queue.take(events));

    return { ...scene, event };
  }
);

it.effect.each(["join", "email"] as const)(
  "posted %s re-resolves saved event content before the existing recipient",
  (action) =>
    Effect.gen(function* freshRecipient() {
      const { model, event, notification } = yield* postedAction(action);
      const saved = Option.getOrThrow(AsyncData.getData(model.upcoming.data));

      const current = {
        ...model,
        upcoming: {
          ...model.upcoming,
          data: AsyncData.Success({
            data: {
              ...saved,
              events: saved.events.map((item) => ({
                ...item,
                attendees: [
                  {
                    email: "current-guest@example.test",
                    responseStatus: "accepted" as const,
                  },
                ],
                conferenceUrl: "https://meet.google.com/new-code-room",
              })),
            },
          }),
        },
      };

      const result = update(
        current,
        Message.ObservedNotification({ event, now: model.calendar.now })
      );

      if (action === "email") {
        expect(
          result.commands?.find(
            (command) => command.name === "FollowRouteRequest"
          )?.args
        ).toEqual({
          request: UrlRequest.External({
            href: "mailto:current-guest@example.test?subject=Weekly%20project%20review",
          }),
        });
      } else {
        const command = result.commands?.find(
          (item) => item.name === "JoinMeeting"
        );

        const args = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ personId: Schema.String, selection: JoinSelection })
        )(command?.args);

        const opened: {
          readonly conferenceUrl: string;
          readonly key: { readonly eventId: string };
        }[] = [];

        yield* JoinMeeting(args).effect.pipe(
          Effect.provideService(MeetingPort, {
            open: (request) =>
              Effect.sync(() => {
                opened.push(request);

                return MeetingJoinOutcome.cases.Requested.make({
                  key: request.key,
                });
              }),
          })
        );
        expect(opened).toEqual([
          {
            conferenceUrl: "https://meet.google.com/new-code-room",
            key: {
              accountId: notification.candidate.event.accountId,
              calendarId: notification.candidate.event.calendarId,
              eventId: notification.candidate.event.eventId,
            },
          },
        ]);
      }
    })
);

it.effect.each(["show", "join", "email", "start"] as const)(
  "posted %s ignores an occurrence that moved or disappeared after display",
  (action) =>
    Effect.gen(function* staleOccurrence() {
      const { model, event } = yield* postedAction(action);
      const saved = Option.getOrThrow(AsyncData.getData(model.upcoming.data));

      for (const removed of [false, true]) {
        const current = {
          ...model,
          upcoming: {
            ...model.upcoming,
            data: AsyncData.Success({
              data: {
                ...saved,
                events: removed
                  ? []
                  : saved.events.map((item) => ({
                      ...item,
                      start: { dateTime: "2026-10-20T13:02:00.000Z" },
                    })),
              },
            }),
          },
        };

        const result = update(
          current,
          Message.ObservedNotification({ event, now: model.calendar.now })
        );

        expect(result.commands ?? []).toEqual([]);
        expect(result.model.calendar.selected).toEqual(
          current.calendar.selected
        );
      }

      const mismatched = update(
        model,
        Message.ObservedNotification({
          event: NotificationEvent.cases.Action.make({
            ...event,
            tag: "another-tag",
          }),
          now: model.calendar.now,
        })
      );

      expect(mismatched.model).toBe(model);
      expect(mismatched.commands ?? []).toEqual([]);

      const desktop = {
        ...model,
        desktop: { ...model.desktop, availability: "available" as const },
      };

      expect(
        update(
          desktop,
          Message.ObservedNotification({ event, now: model.calendar.now })
        ).model
      ).toBe(desktop);
    })
);

it.effect.each([false, true])(
  "posted until-start uses the actual sampled-clock command and refuses after start (%s)",
  (started) =>
    Effect.gen(function* sampledWorkerSnooze() {
      const { model, event, notification } = yield* postedAction("start");

      const requested = update(
        model,
        Message.ObservedNotification({ event, now: model.calendar.now })
      );

      const command = requested.commands?.find(
        (item) => item.name === "SampleReminderSnoozeClock"
      );

      const args = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          choice: ReminderSnoozeChoice,
          id: Schema.String,
          identity: Schema.String,
          personId: Schema.String,
        })
      )(command?.args);

      if (started) {
        yield* TestClock.setTime(notification.candidate.start);
      }

      const sampled = yield* SampleReminderSnoozeClock(args).effect;
      const settled = update(requested.model, sampled);

      const persistence = settled.commands?.find(
        (item) => item.name === "PersistReminderSnooze"
      );

      if (started) {
        expect(persistence).toBeUndefined();
        expect(
          Option.getOrUndefined(settled.model.reminders.failure)
        ).toContain("already started");
        expect(
          settled.model.reminders.context.active.map((item) => item.id)
        ).toContain(notification.id);
      } else {
        expect(persistence?.args).toEqual({
          entry: {
            due: notification.candidate.start,
            identity: notification.candidate.identity,
          },
          id: notification.id,
          personId: notification.personId,
        });
      }
    })
);
