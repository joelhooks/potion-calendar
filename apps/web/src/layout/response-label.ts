import type { CalendarEventValue } from "@calendar/calendar/contracts";

type ParticipantResponse = NonNullable<
  CalendarEventValue["attendees"]
>[number]["responseStatus"];

const responseLabels: Record<
  Exclude<ParticipantResponse, undefined>,
  string
> = {
  accepted: "Yes",
  declined: "No",
  needsAction: "Not answered",
  tentative: "Maybe",
};

export const responseLabel = (response: ParticipantResponse): string =>
  response === undefined ? "Not answered" : responseLabels[response];
