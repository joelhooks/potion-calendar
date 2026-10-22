import { Option } from "effect";
import { UrlRequest } from "foldkit/navigation";

import { conferenceLink } from "../../layout/conferencing.js";
import type { AppModel, update } from "../app.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import { FollowRouteRequest } from "../routing.js";
import {
  currentReminderCard,
  reminderParticipantEmail,
} from "./card-selection.js";
import type { ReminderCardAction } from "./model.js";
import { selectReminderNotification } from "./selection.js";
import { resolveReminderPresentation } from "./update.js";

type Result = ReturnType<typeof update>;

export const actOnReminderCard = (
  model: AppModel,
  personId: string,
  id: string,
  action: typeof ReminderCardAction.Type,
  apply: (model: AppModel, message: AppMessage) => Result
): Result => {
  const notification = currentReminderCard(model, personId, id);

  if (notification === undefined) {
    return { model };
  }

  let result: Result = { model };

  if (action === "show") {
    result = selectReminderNotification(model, notification, apply);
  } else if (action === "join") {
    const { event } = notification.candidate;

    if (
      conferenceLink(event.conferenceUrl, event.description, event.location) ===
      undefined
    ) {
      return { model };
    }

    result = apply(
      model,
      Message.RequestedJoinMeeting({
        key: Option.some({
          accountId: notification.candidate.event.accountId,
          calendarId: notification.candidate.event.calendarId,
          eventId: notification.candidate.event.eventId,
        }),
      })
    );
  } else if (action === "email") {
    const email = reminderParticipantEmail(model, notification);

    if (email.kind !== "ready") {
      return { model };
    }

    result = {
      commands: [
        FollowRouteRequest({
          request: UrlRequest.External({ href: email.href }),
        }),
      ],
      model,
    };
  }

  const resolved = resolveReminderPresentation(result.model, personId, id);

  return {
    ...resolved,
    commands: [...(result.commands ?? []), ...(resolved.commands ?? [])],
  };
};
