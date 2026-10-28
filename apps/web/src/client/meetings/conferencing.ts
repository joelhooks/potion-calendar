import { conferenceLink } from "@calendar/calendar/conferencing";
import type { CustomVideoLink } from "@calendar/calendar/conferencing";
import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { ConferenceUrl } from "@calendar/core/desktop-bridge";
import { Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../app.js";

export const safeMeetingUrl = (value: string | undefined): string | undefined =>
  Option.getOrUndefined(Schema.decodeOption(ConferenceUrl)(value ?? ""));

export const confirmedCustomVideoLinks = (
  model: AppModel
): readonly (typeof CustomVideoLink.Type)[] => {
  const session = AsyncData.isSuccess(model.session)
    ? model.session.data
    : undefined;

  const { mode } = model.conferencingSettings;

  if (
    session === undefined ||
    session === null ||
    !Option.contains(model.person, session.user.id) ||
    (mode !== "listing" && mode !== "editing" && mode !== "savingDefault")
  ) {
    return [];
  }

  return model.conferencingSettings.entries.filter((entry) =>
    Schema.is(ConferenceUrl)(entry.link)
  );
};

export const savedMeetingConferenceLink = (
  model: AppModel,
  event: CalendarEventValue
): string | undefined =>
  safeMeetingUrl(
    conferenceLink(
      event.conferenceUrl,
      event.location,
      event.description,
      confirmedCustomVideoLinks(model)
    )
  );
