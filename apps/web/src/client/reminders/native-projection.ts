import { ConferenceUrl } from "@calendar/core/desktop-bridge";
import type { NativeNotificationAgenda } from "@calendar/core/desktop-bridge";
import { Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { conferenceLink } from "../../layout/conferencing.js";
import { participantEmail } from "../../layout/email-participants.js";
import { rsvpSelf } from "../../layout/rsvp-eligibility.js";
import type { AppModel } from "../app.js";
import { responseIsBusy } from "../editing/response-availability.js";
import { acceptedReminderCandidates } from "./accepted-candidates.js";
import type { NotificationContentValue, ReminderState } from "./model.js";

export const nativeNotificationLease = (model: AppModel): string | undefined =>
  model.desktop.availability === "available"
    ? (model.desktop.notificationLease ??
      Option.getOrUndefined(AsyncData.getData(model.desktop.settings))?.runtime
        ?.notificationLease)
    : undefined;

export const nativeRemindersEnabled = (model: AppModel): boolean =>
  nativeNotificationLease(model) !== undefined &&
  Option.getOrUndefined(AsyncData.getData(model.desktop.settings))?.preferences
    .menuBar === true;

export const nativeNotificationAgenda = (
  model: AppModel
): typeof NativeNotificationAgenda.Type | undefined => {
  const lease = nativeNotificationLease(model);

  if (lease === undefined) {
    return undefined;
  }

  const personId = Option.getOrNull(model.person);
  const session = Option.getOrUndefined(AsyncData.getData(model.session));

  const ownEmails =
    session === undefined || session === null || session.user.id !== personId
      ? undefined
      : [
          session.user.email,
          ...session.accounts.map((account) => account.email),
        ];

  const candidates =
    personId === null || !nativeRemindersEnabled(model)
      ? []
      : acceptedReminderCandidates(model);

  return {
    deliveries: model.reminders.context.active.flatMap((notification) => {
      if (
        notification.nativeKind === undefined ||
        notification.personId !== personId
      ) {
        return [];
      }

      const delivery = {
        id: notification.id,
        key: {
          accountId: notification.candidate.event.accountId,
          calendarId: notification.candidate.event.calendarId,
          eventId: notification.candidate.event.eventId,
        },
        kind: notification.nativeKind,
        start: notification.candidate.start,
      };

      if (notification.nativeKind === "reminder") {
        Object.assign(delivery, {
          beforeStart: notification.candidate.start > model.calendar.now,
        });
      }

      if (notification.nativeSnoozedUntil !== undefined) {
        Object.assign(delivery, {
          snoozedUntil: notification.nativeSnoozedUntil,
        });
      }

      return [delivery];
    }),
    events: candidates
      .filter(
        (candidate) =>
          candidate.end > model.calendar.now ||
          model.reminders.context.active.some(
            (notification) =>
              notification.nativeKind === "reminder" &&
              notification.nativeSnoozedUntil !== undefined &&
              notification.nativeSnoozedUntil <= model.calendar.now &&
              notification.candidate.identity === candidate.identity &&
              notification.candidate.start === candidate.start
          )
      )
      .map((candidate) => {
        const { event } = candidate;

        const email =
          ownEmails === undefined
            ? undefined
            : participantEmail(event, ownEmails);

        return {
          body: candidate.body,
          conferenceUrl: Option.getOrNull(
            Schema.decodeOption(ConferenceUrl)(
              conferenceLink(
                event.conferenceUrl,
                event.description,
                event.location
              ) ?? ""
            )
          ),
          end: candidate.end,
          key: {
            accountId: event.accountId,
            calendarId: event.calendarId,
            eventId: event.eventId,
          },
          participantEmails: email?.kind === "ready" ? email.recipients : [],
          rsvp: rsvpSelf(event) !== undefined && !responseIsBusy(model),
          start: candidate.start,
          title: candidate.title,
        };
      }),
    lease,
    personId,
    revision: model.desktop.notificationRevision ?? 0,
    version: 1,
  };
};

export const nativeRetryDeliveries = (
  model: AppModel,
  state: typeof ReminderState.Type
) => {
  const agenda = nativeNotificationAgenda({ ...model, reminders: state });
  const deliveries: NotificationContentValue[] = [];

  const active = state.context.active.map((notification) => {
    const retry = notification.nativeRetry;

    if (retry?.status !== "waiting") {
      return notification;
    }

    const { candidate } = notification;

    const current = agenda?.events.find(
      (event) =>
        event.key.accountId === candidate.event.accountId &&
        event.key.calendarId === candidate.event.calendarId &&
        event.key.eventId === candidate.event.eventId &&
        event.start === candidate.start &&
        (event.end > model.calendar.now ||
          (notification.nativeSnoozedUntil !== undefined &&
            notification.nativeSnoozedUntil <= model.calendar.now))
    );

    if (
      agenda === undefined ||
      agenda.lease !== retry.lease ||
      agenda.personId !== notification.personId ||
      !nativeRemindersEnabled(model) ||
      current === undefined
    ) {
      return { ...notification, nativeRetry: undefined };
    }

    if (agenda.revision <= retry.revision) {
      return notification;
    }

    const next = {
      ...notification,
      nativeRetry: {
        ...retry,
        revision: agenda.revision,
        status: "attempted" as const,
      },
    };

    deliveries.push(next);

    return next;
  });

  return {
    deliveries,
    state: { ...state, context: { ...state.context, active } },
  };
};
