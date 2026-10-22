import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import {
  currentReminderCard,
  reminderParticipantEmail,
} from "../client/reminders/card-selection.js";
import type { ReminderCardAction } from "../client/reminders/model.js";
import { conferenceLink } from "../layout/conferencing.js";

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
                : [h.button([h.OnClick(send("join"))], ["Join"])]),
              h.button([h.OnClick(send("show"))], ["Show"]),
              ...(email.kind === "ready"
                ? [
                    h.button(
                      [h.OnClick(send("email"))],
                      ["Email participants…"]
                    ),
                  ]
                : []),
              h.button([h.OnClick(send("dismiss"))], ["Dismiss"]),
            ]
          ),
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
