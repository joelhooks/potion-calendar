import type { CalendarEventValue } from "@calendar/calendar/contracts";
import type { AgendaKeyValue } from "@calendar/core/desktop-bridge";
import { MeetingJoinOutcome } from "@calendar/core/desktop-bridge";
import { Option } from "effect";

import { conferenceLink } from "../../layout/conferencing.js";
import { visibleEvents } from "../../layout/presentation.js";
import type { AppModel } from "../app.js";
import { nextJoinMeeting } from "./candidates.js";
import { JoinSelection } from "./model.js";
import { savedEvent, savedMeetings } from "./source.js";

const linkFor = (source: CalendarEventValue): typeof JoinSelection.Type => {
  const conferenceUrl = conferenceLink(
    source.conferenceUrl,
    source.location,
    source.description
  );

  return conferenceUrl === undefined
    ? JoinSelection.cases.Unavailable.make({
        outcome: MeetingJoinOutcome.cases.NoMeeting.make({
          reason: "noConferencing",
        }),
      })
    : JoinSelection.cases.Available.make({
        conferenceUrl,
        key: {
          accountId: source.accountId,
          calendarId: source.calendarId,
          eventId: source.eventId,
        },
      });
};

export const joinSelection = (
  model: AppModel,
  key?: AgendaKeyValue
): typeof JoinSelection.Type => {
  if (key !== undefined) {
    const item = savedMeetings(model).find((candidate) =>
      candidate.item.copies.some(
        (copy) =>
          copy.source.accountId === key.accountId &&
          copy.source.calendarId === key.calendarId &&
          copy.source.eventId === key.eventId
      )
    )?.item;

    return item === undefined
      ? JoinSelection.cases.Unavailable.make({
          outcome: MeetingJoinOutcome.cases.Failed.make({
            message: "This meeting is no longer available.",
          }),
        })
      : linkFor(item.source);
  }

  if (Option.isSome(model.calendar.selected)) {
    const item = visibleEvents(model).find((event) => event.selected);

    const source =
      item === undefined ? undefined : savedEvent(model, item.source);

    return source === undefined
      ? JoinSelection.cases.Unavailable.make({
          outcome: MeetingJoinOutcome.cases.Failed.make({
            message: "The selected event is no longer available.",
          }),
        })
      : linkFor(source);
  }

  const candidate = nextJoinMeeting(
    savedMeetings(model),
    model.calendar.now,
    model.settings.upcomingMeetingMinutes
  );

  return candidate === undefined
    ? JoinSelection.cases.Unavailable.make({
        outcome: MeetingJoinOutcome.cases.NoMeeting.make({
          reason: "noUpcoming",
        }),
      })
    : linkFor(candidate.item.source);
};
