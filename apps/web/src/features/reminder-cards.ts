import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import {
  currentReminderCard,
  reminderParticipantEmail,
} from "../client/reminders/card-selection.js";
import {
  reminderSnoozeMinutes,
  reminderSnoozeElementId,
  ReminderSnoozeStorage,
  reminderSnoozeOperationIdentity,
  reminderSnoozeCanStart,
  reminderSnoozeIsSessionOnly,
} from "../client/reminders/model.js";
import type {
  ReminderCardAction,
  ReminderSnoozeChoice,
} from "../client/reminders/model.js";
import { conferenceLink } from "../layout/conferencing.js";

const snoozeStorageNotice = (
  storage: typeof ReminderSnoozeStorage.Type | undefined
): string | undefined => {
  if (reminderSnoozeIsSessionOnly(storage)) {
    return "Snoozes won't be kept after a reload.";
  }

  if (
    storage === undefined ||
    ReminderSnoozeStorage.guards.Unloaded(storage) ||
    ReminderSnoozeStorage.guards.Loading(storage)
  ) {
    return "Loading snoozes…";
  }

  return undefined;
};

export const reminderCards = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  if (
    model.desktop.availability !== "unavailable" ||
    Option.isNone(model.person)
  ) {
    return [];
  }

  const cards = model.reminders.context.active.flatMap((entry) => {
    const notification = currentReminderCard(model, entry.personId, entry.id);

    if (notification?.card === undefined) {
      return [];
    }

    const { candidate } = notification;
    const { event } = candidate;

    const join = conferenceLink(
      event.conferenceUrl,
      event.description,
      event.location
    );

    const email = reminderParticipantEmail(model, notification);

    const send = (action: typeof ReminderCardAction.Type) =>
      Message.ReminderCardAction({
        action,
        id: notification.id,
        personId: notification.personId,
      });

    const snooze = (choice: typeof ReminderSnoozeChoice.Type) =>
      Message.RequestedReminderSnooze({
        choice,
        id: notification.id,
        personId: notification.personId,
      });

    const storage = model.reminders.context.snoozeStorage;
    const snoozeReady = reminderSnoozeCanStart(storage);
    const snoozeStorageCopy = snoozeStorageNotice(storage);

    const snoozeBusy = Option.contains(
      reminderSnoozeOperationIdentity(storage),
      candidate.identity
    );

    return [
      h.keyed("section")(
        notification.id,
        [
          h.Class("calendar-read-notice reminder-card"),
          h.Role("status"),
          h.AriaLabel(notification.title),
        ],
        [
          h.p(
            [h.Class("muted")],
            [
              notification.card.kind === "upcoming"
                ? "Upcoming meeting"
                : "Reminder",
            ]
          ),
          h.h2([], [candidate.title]),
          h.p([], [candidate.body]),
          h.p([h.Class("muted")], [candidate.calendar.title]),
          h.div(
            [h.Class("meeting-actions")],
            [
              ...(join === undefined
                ? []
                : [
                    h.button(
                      [h.Disabled(snoozeBusy), h.OnClick(send("join"))],
                      ["Join"]
                    ),
                  ]),
              h.button(
                [h.Disabled(snoozeBusy), h.OnClick(send("show"))],
                ["Show"]
              ),
              ...(email.kind === "ready"
                ? [
                    h.button(
                      [h.Disabled(snoozeBusy), h.OnClick(send("email"))],
                      ["Email participants…"]
                    ),
                  ]
                : []),
              h.button(
                [h.Disabled(snoozeBusy), h.OnClick(send("dismiss"))],
                ["Dismiss"]
              ),
            ]
          ),
          h.details(
            [
              h.Class("reminder-snooze"),
              h.Id(
                reminderSnoozeElementId(notification.personId, notification.id)
              ),
              h.OnToggle((open) =>
                Message.ReminderSnoozeDisclosureChanged({
                  id: notification.id,
                  open,
                  personId: notification.personId,
                })
              ),
            ],
            [
              h.summary([], ["Snooze"]),
              ...(snoozeStorageCopy === undefined
                ? []
                : [h.p([h.Class("muted")], [snoozeStorageCopy])]),
              h.div(
                [h.Class("reminder-snooze-choices")],
                [
                  ...reminderSnoozeMinutes.map((minutes) =>
                    h.button(
                      [h.Disabled(!snoozeReady), h.OnClick(snooze(minutes))],
                      [minutes === 1 ? "1 minute" : `${minutes} minutes`]
                    )
                  ),
                  ...(model.calendar.now < candidate.start
                    ? [
                        h.button(
                          [
                            h.Disabled(!snoozeReady),
                            h.OnClick(snooze("start")),
                          ],
                          ["Until start"]
                        ),
                      ]
                    : []),
                ]
              ),
              h.p(
                [h.Class("muted")],
                ["Reminders can fire only while Calendar is open."]
              ),
            ]
          ),
          ...Option.match(model.reminders.failure, {
            onNone: () => [],
            onSome: (failure) => [h.p([h.Role("alert")], [failure])],
          }),
          ...(email.kind === "ready"
            ? [
                h.p(
                  [h.Class("muted reminder-card-mailto")],
                  ["Opens your mail app."]
                ),
              ]
            : []),
        ]
      ),
    ];
  });

  return cards.length === 0 ? [] : [h.div([h.Class("reminder-cards")], cards)];
};
