import type { CalendarEventValue } from "@calendar/calendar/contracts";
import type { AgendaKeyValue } from "@calendar/core/desktop-bridge";
import { Option } from "effect";
import { AsyncData } from "foldkit";

import { primaryAccountId } from "../../layout/primary-account.js";
import type { AppModel } from "../app.js";
import { meetingCandidates } from "./candidates.js";
import { confirmedCustomVideoLinks, safeMeetingUrl } from "./conferencing.js";

export const savedEvent = (
  model: AppModel,
  key: AgendaKeyValue
): CalendarEventValue | undefined => {
  const matches = (event: CalendarEventValue) =>
    event.accountId === key.accountId &&
    event.calendarId === key.calendarId &&
    event.eventId === key.eventId;

  for (const read of model.calendar.reads) {
    const events = Option.getOrUndefined(
      AsyncData.getData(read.events)
    )?.events;

    const event = events?.find(matches);

    if (event !== undefined) {
      return event;
    }
  }

  return (
    Option.getOrUndefined(model.search.response)?.results.find((result) =>
      matches(result.event)
    )?.event ??
    Option.getOrUndefined(AsyncData.getData(model.upcoming.data))?.events.find(
      matches
    )
  );
};

export const savedMeetings = (model: AppModel) => {
  if (Option.isNone(model.person)) {
    return [];
  }

  const saved = AsyncData.getData(model.upcoming.data);
  const session = Option.getOrUndefined(AsyncData.getData(model.session));
  const accounts = session?.accounts ?? [];

  return meetingCandidates({
    accounts: accounts.map((account) => account.id),
    calendars: model.calendar.calendars,
    customVideoLinks: confirmedCustomVideoLinks(model),
    events: Option.isSome(saved) ? saved.value.events : [],
    hidden: model.calendar.hidden,
    primaryAccount: primaryAccountId(session),
    zone: model.calendar.zone,
  }).map((candidate) => ({
    ...candidate,
    conferenceUrl: safeMeetingUrl(candidate.conferenceUrl),
  }));
};
