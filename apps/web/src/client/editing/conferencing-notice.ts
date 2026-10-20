import { conferenceLink } from "@calendar/calendar/conferencing";
import { Option } from "effect";

import { ConferencingSaveNotice } from "../conferencing/model.js";
import type { EditorMutation } from "./editor-session-model.js";

type Saved = typeof EditorMutation.cases.Saved.Type;

const removalStatus = (event: Saved["event"]): "removed" | "unconfirmed" =>
  event.conference === undefined &&
  event.conferencingStatus === undefined &&
  conferenceLink(event.conferenceUrl, event.location, event.description) ===
    undefined
    ? "removed"
    : "unconfirmed";

export const savedConferencingNotice = ({
  event,
  id,
  plan,
}: Saved): Option.Option<typeof ConferencingSaveNotice.Type> => {
  const request = plan.session.draft.conferencing?.request;

  if (
    request === undefined &&
    (plan.session.kind === "edit" || event.conferencingStatus === undefined)
  ) {
    return Option.none();
  }

  const status =
    request?.kind === "none"
      ? removalStatus(event)
      : (event.conferencingStatus ?? "unconfirmed");

  return Option.some(
    ConferencingSaveNotice.make({
      accountId: event.accountId,
      calendarId: event.calendarId,
      eventId: event.eventId,
      id,
      status,
      title: event.title ?? "Untitled event",
    })
  );
};
