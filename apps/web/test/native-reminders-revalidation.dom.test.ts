import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { calendarKey } from "../src/client/calendar-state.js";
import {
  NotificationContent,
  NotificationFailure,
} from "../src/client/reminders/model.js";
import { commitReminders } from "../src/client/reminders/update.js";
import { nativeReminderModel } from "./native-reminders-fixture.js";

it.effect(
  "a stale queued native operation revalidates through the current saved Model without firing the scheduler again",
  () =>
    Effect.gen(function* revalidate() {
      const { model, ref } = nativeReminderModel();

      const result = update(
        model,
        Message.ReminderDeliveryCompleted({
          failure: Option.some(
            new NotificationFailure({
              lease: ref.lease,
              personId: ref.personId,
              reason: "stale",
              revision: ref.revision - 1,
            })
          ),
          id: ref.id,
          personId: ref.personId,
        })
      );

      expect(
        result.model.reminders.context.active[0]?.nativeRetry
      ).toMatchObject({ revision: ref.revision, status: "attempted" });
      expect(result.commands?.map((command) => command.name)).toEqual([
        "DeliverReminderNotification",
      ]);

      const args = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ notification: NotificationContent })
      )(result.commands?.[0]?.args);

      expect(
        args.notification.native?.snapshot.notificationAgenda?.revision
      ).toBe(ref.revision);
      expect(args.notification.id).toBe(ref.id);
      expect(result.model.reminders.context.fired).toBe(
        model.reminders.context.fired
      );
    })
);

it.effect(
  "a superseded attempt waits for the next publication and records the single retry revision",
  () =>
    Effect.sync(() => {
      const { model, ref } = nativeReminderModel();

      const failed = Message.ReminderDeliveryCompleted({
        failure: Option.some(
          new NotificationFailure({
            lease: ref.lease,
            personId: ref.personId,
            reason: "stale",
            revision: ref.revision,
          })
        ),
        id: ref.id,
        personId: ref.personId,
      });

      const pending = update(model, failed);

      expect(pending.commands ?? []).toEqual([]);
      expect(
        pending.model.reminders.context.active[0]?.nativeRetry?.status
      ).toBe("waiting");

      const newer = {
        ...pending.model,
        desktop: {
          ...pending.model.desktop,
          notificationRevision: ref.revision + 1,
        },
      };

      const retried = commitReminders(newer, newer.reminders);

      expect(retried.commands?.map((command) => command.name)).toEqual([
        "DeliverReminderNotification",
      ]);
      expect(
        retried.model.reminders.context.active[0]?.nativeRetry
      ).toMatchObject({ revision: ref.revision + 1, status: "attempted" });
      expect(update(retried.model, failed).commands ?? []).toEqual([]);
      expect(
        commitReminders(retried.model, retried.model.reminders).commands ?? []
      ).toEqual([]);
      expect(retried.model.reminders.context.fired).toBe(
        model.reminders.context.fired
      );
    })
);

it.effect.each(["delivery", "unsupported", "inactive", "expired"] as const)(
  "final %s failure never becomes a publication retry",
  (reason) =>
    Effect.sync(() => {
      const { model, ref } = nativeReminderModel();

      const failed = update(
        model,
        Message.ReminderDeliveryCompleted({
          failure: Option.some(new NotificationFailure({ reason })),
          id: ref.id,
          personId: ref.personId,
        })
      );

      const newer = {
        ...failed.model,
        desktop: {
          ...failed.model.desktop,
          notificationRevision: ref.revision + 1,
        },
      };

      expect(commitReminders(newer, newer.reminders).commands ?? []).toEqual(
        []
      );
      expect(newer.reminders.context.active).toEqual([]);
    })
);

it.effect.each(["same-revision", "hidden", "wrong-person"] as const)(
  "native stale %s results do not spin or replay unavailable events",
  (change) =>
    Effect.sync(() => {
      const { model, ref } = nativeReminderModel();

      const current =
        change === "hidden"
          ? {
              ...model,
              calendar: {
                ...model.calendar,
                hidden: [calendarKey(ref.key.accountId, ref.key.calendarId)],
              },
            }
          : model;

      const result = update(
        current,
        Message.ReminderDeliveryCompleted({
          failure: Option.some(
            new NotificationFailure({
              lease: ref.lease,
              personId: ref.personId,
              reason: "stale",
              revision:
                change === "same-revision" ? ref.revision : ref.revision - 1,
            })
          ),
          id: ref.id,
          personId: change === "wrong-person" ? "old-person" : ref.personId,
        })
      );

      expect(result.commands ?? []).toEqual([]);
    })
);

it.effect.each(["lease", "person"] as const)(
  "a delayed first stale completion with the old attempt %s cannot acquire current identity",
  (change) =>
    Effect.sync(() => {
      const { model, ref } = nativeReminderModel();
      expect(model.reminders.context.active[0]).not.toHaveProperty(
        "nativeRetry"
      );

      const completion = Message.ReminderDeliveryCompleted({
        failure: Option.some(
          new NotificationFailure({
            lease: ref.lease,
            personId: change === "person" ? "old-person" : ref.personId,
            reason: "stale",
            revision: ref.revision,
          })
        ),
        id: ref.id,
        personId: ref.personId,
      });

      const current = {
        ...model,
        desktop: {
          ...model.desktop,
          notificationLease: change === "lease" ? "new-lease" : ref.lease,
          notificationRevision: ref.revision + 1,
        },
      };

      const completed = update(current, completion);
      expect(completed.commands ?? []).toEqual([]);
      expect(completed.model.reminders.context.active).toEqual([]);
      expect(completed.model.reminders.context.fired).toBe(
        model.reminders.context.fired
      );

      const newer = {
        ...completed.model,
        desktop: {
          ...completed.model.desktop,
          notificationRevision: ref.revision + 2,
        },
      };

      expect(commitReminders(newer, newer.reminders).commands ?? []).toEqual(
        []
      );
    })
);
