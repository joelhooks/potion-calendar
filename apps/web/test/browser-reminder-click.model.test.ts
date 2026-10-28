import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { calendarKey, eventKey } from "../src/client/calendar-state.js";
import {
  NotificationEvent,
  notificationTag,
  ReminderSnoozeRestore,
  ReminderSnoozeStorage,
} from "../src/client/reminders/model.js";
import type { NotificationContentValue } from "../src/client/reminders/model.js";
import { reminderCardScene } from "./reminder-card-fixture.js";
import {
  upcomingCalendars,
  upcomingNow,
  upcomingSession,
} from "./upcoming-fixture.js";

const delivery = Schema.Literals(["plain", "worker"]);

const click = (
  model: AppModel,
  notification: NotificationContentValue,
  path: typeof delivery.Type
) =>
  update(
    model,
    Message.ObservedNotification({
      event:
        path === "plain"
          ? NotificationEvent.cases.Clicked.make({ notification })
          : NotificationEvent.cases.Action.make({
              action: "show",
              id: notification.id,
              personId: notification.personId,
              tag: notificationTag(
                notification.personId,
                notification.candidate.identity
              ),
            }),
      now: model.calendar.now,
    })
  );

const fixture = () => {
  const { model } = reminderCardScene("reminder", "light", 1440);
  const [notification] = model.reminders.context.active;

  if (notification === undefined) {
    throw new Error("Missing managed reminder");
  }

  return {
    model: { ...model, calendar: { ...model.calendar, selected: [] } },
    notification,
  };
};

it.effect.prop(
  "HIGH body click selects the saved event and retains the exact card on both delivery paths",
  { path: delivery },
  ({ path }) =>
    Effect.sync(() => {
      const { model, notification } = fixture();
      const selected = click(model, notification, path);
      expect(
        selected.model.calendar.selected,
        "body click selects its saved event"
      ).toEqual([notification.candidate.key]);
      expect(
        selected.model.reminders,
        "HIGH body click must retain the exact active card"
      ).toBe(model.reminders);
      expect(
        (selected.commands ?? []).some(
          (command) => command.name === "CloseReminderNotifications"
        ),
        "HIGH body click cannot close its card"
      ).toBe(false);
      const repeated = click(selected.model, notification, path);
      expect(repeated.model).toBe(selected.model);
      expect(repeated.commands ?? []).toEqual([]);
    })
);

it.effect.prop(
  "HIGH another person's colliding reminder cannot select or retire the current person's card",
  { path: delivery },
  ({ path }) =>
    Effect.sync(() => {
      const { model, notification } = fixture();
      const foreign = { ...notification, personId: "p74-other-person" };
      const result = click(model, foreign, path);
      expect(
        result.model.calendar.selected,
        "HIGH another person's reminder cannot select in this session"
      ).toEqual([]);
      expect(
        result.model,
        "HIGH another person's reminder cannot change this person's card"
      ).toBe(model);
      expect(result.commands ?? []).toEqual([]);
    })
);

it.effect.prop(
  "retired, resolved and signed-out callbacks are silent on both paths",
  {
    path: delivery,
    state: Schema.Literals(["retired", "resolved", "signed-out"]),
  },
  ({ path, state }) =>
    Effect.sync(() => {
      const { model, notification } = fixture();

      const next =
        state === "signed-out"
          ? update(model, Message.ReceivedSession({ snapshot: null })).model
          : {
              ...model,
              reminders: {
                ...model.reminders,
                context: {
                  ...model.reminders.context,
                  active:
                    state === "retired"
                      ? []
                      : [
                          {
                            ...notification,
                            card: {
                              kind: "reminder" as const,
                              state: "resolved" as const,
                            },
                          },
                        ],
                },
              },
            };

      const result = click(next, notification, path);
      expect(result.model).toBe(next);
      expect(result.commands ?? []).toEqual([]);
    })
);

it.effect.prop(
  "gone and hidden saved events refuse with generic copy without changing the card or navigation",
  { hidden: Schema.Boolean, path: delivery },
  ({ path, hidden }) =>
    Effect.sync(() => {
      const { model, notification } = fixture();

      const next = hidden
        ? {
            ...model,
            calendar: {
              ...model.calendar,
              hidden: [
                calendarKey(
                  notification.candidate.event.accountId,
                  notification.candidate.event.calendarId
                ),
              ],
            },
          }
        : {
            ...model,
            upcoming: {
              ...model.upcoming,
              data: AsyncData.Success({ data: { events: [], versions: [] } }),
            },
          };

      const result = click(next, notification, path);
      expect(result.model.calendar).toBe(next.calendar);
      expect(result.model.reminders.context).toBe(next.reminders.context);
      expect(result.model.reminders.failure).toEqual(
        Option.some("This reminder’s event is no longer available.")
      );
      expect(result.commands ?? []).toEqual([]);
    })
);

it.effect.each(["plain", "worker"] as const)(
  "%s pending snooze keeps its operation and card untouched after body click",
  (path) =>
    Effect.sync(() => {
      const { model, notification } = fixture();

      const next = update(
        model,
        Message.RequestedReminderSnooze({
          choice: 5,
          id: notification.id,
          personId: notification.personId,
        })
      ).model;

      expect(
        ReminderSnoozeStorage.guards.Sampling(
          next.reminders.context.snoozeStorage
        )
      ).toBe(true);

      const result = click(next, notification, path);
      expect(result.model).toBe(next);
      expect(result.commands ?? []).toEqual([]);
    })
);

it.effect.prop(
  "body selection respects expanded occurrence and merged or unmerged identity",
  { merged: Schema.Boolean, path: delivery },
  ({ path, merged }) =>
    Effect.sync(() => {
      const { model, notification } = fixture();
      expect(notification.candidate.event.recurringEventId).toBeDefined();
      expect(notification.candidate.event.eventId).not.toBe(
        notification.candidate.event.recurringEventId
      );

      const next = {
        ...model,
        calendar: { ...model.calendar, mergeDuplicates: merged },
      };

      const result = click(next, notification, path);
      expect(result.model.calendar.selected).toEqual([
        merged
          ? notification.candidate.key
          : eventKey(notification.candidate.event),
      ]);
      expect(result.model.reminders).toBe(next.reminders);
    })
);

it.effect.each(["plain", "worker"] as const)(
  "%s HIGH real session switch refuses the previous person's colliding callback",
  (path) =>
    Effect.sync(() => {
      const { model, notification } = fixture();
      const personId = "p74-next-person";

      let next = update(
        model,
        Message.ReceivedSession({
          snapshot: {
            ...upcomingSession,
            user: { ...upcomingSession.user, id: personId },
          },
        })
      ).model;

      next = update(
        next,
        Message.ReceivedCalendars({ personId, result: upcomingCalendars })
      ).model;
      next = update(
        next,
        Message.ReceivedUpcoming({
          personId,
          request: next.upcoming.request,
          result: {
            events: [
              {
                ...notification.candidate.event,
                end: { dateTime: "2026-10-20T12:33:00.000Z" },
                start: { dateTime: "2026-10-20T12:03:00.000Z" },
              },
            ],
            versions: [],
          },
        })
      ).model;
      next = update(
        next,
        Message.ReminderSnoozesRestored({
          outcome: ReminderSnoozeRestore.cases.Restored.make({ entries: [] }),
          personId,
        })
      ).model;
      next = update(
        next,
        Message.ObservedNotification({
          event: NotificationEvent.cases.Permission.make({
            permission: "granted",
            personId,
          }),
          now: upcomingNow,
        })
      ).model;
      next = update(
        next,
        Message.Ticked({ now: upcomingNow + 2 * 60_000 })
      ).model;
      expect(next.person).toEqual(Option.some(personId));
      expect(next.reminders.context.active).toHaveLength(1);
      expect(next.reminders.context.active[0]?.id).toBe(notification.id);
      const result = click(next, notification, path);
      expect(
        result.model.calendar.selected,
        "HIGH previous person's callback cannot select in the next session"
      ).toEqual([]);
      expect(result.model.reminders).toBe(next.reminders);
      expect(result.commands ?? []).toEqual([]);
    })
);

it.effect.each(["identity", "start"] as const)(
  "plain callback with stale %s cannot retarget a replacement occurrence",
  (field) =>
    Effect.sync(() => {
      const { model, notification } = fixture();

      const candidate =
        field === "identity"
          ? { ...notification.candidate, identity: "old-occurrence" }
          : {
              ...notification.candidate,
              start: notification.candidate.start - 60_000,
            };

      const result = click(model, { ...notification, candidate }, "plain");
      expect(result.model).toBe(model);
      expect(result.commands ?? []).toEqual([]);
    })
);
