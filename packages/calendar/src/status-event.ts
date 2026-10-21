import type {
  CalendarValue,
  CalendarEventValue,
  EventFieldsValue,
} from "./model.js";

export const statusEventType = (type: EventFieldsValue["eventType"]) =>
  type === "focusTime" || type === "outOfOffice";

export const statusEventAvailability = (
  calendar: CalendarValue | undefined,
  allDay: boolean
):
  | { readonly kind: "ineligible"; readonly reason: string }
  | { readonly kind: "unknown" } => {
  if (calendar?.primary !== true || calendar.accessRole !== "owner") {
    return {
      kind: "ineligible",
      reason:
        "Focus time and Out of office only work on your primary calendar.",
    };
  }

  if (allDay) {
    return {
      kind: "ineligible",
      reason: "Focus time and Out of office can't be all day.",
    };
  }

  return { kind: "unknown" };
};

export const statusEventProperties = (
  event: Pick<
    CalendarEventValue,
    "eventType" | "focusTimeProperties" | "outOfOfficeProperties"
  >
) =>
  [
    { properties: event.focusTimeProperties, type: "focusTime" },
    { properties: event.outOfOfficeProperties, type: "outOfOffice" },
  ].find((entry) => entry.type === event.eventType)?.properties;

export const supportedStatusInvitationMode = (mode: string | undefined) =>
  mode === "declineNone" || mode === "declineOnlyNewConflictingInvitations";

export const statusEventLabel = (type: EventFieldsValue["eventType"]) =>
  type === "focusTime" ? "Focus time" : "Out of office";
