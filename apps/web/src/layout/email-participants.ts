import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { composeParticipantEmail } from "@calendar/core/participant-email";

export type ParticipantEmail =
  | {
      readonly kind: "ready";
      readonly href: string;
      readonly recipients: readonly string[];
    }
  | { readonly kind: "disabled"; readonly reason?: string };

export const participantEmail = (
  event: CalendarEventValue,
  ownEmails: readonly string[]
): ParticipantEmail => {
  if (event.eventType !== undefined && event.eventType !== "default") {
    return { kind: "disabled" };
  }

  if (
    event.guestsCanSeeOtherGuests === false &&
    event.organizer?.self !== true
  ) {
    return {
      kind: "disabled",
      reason: "The organizer has hidden the guest list.",
    };
  }

  if (event.attendeesOmitted === true) {
    return {
      kind: "disabled",
      reason: "Google didn't send the full guest list.",
    };
  }

  const excluded = new Set(
    [
      ...ownEmails,
      ...(event.attendees ?? [])
        .filter((person) => person.self === true || person.resource === true)
        .map((person) => person.email),
    ].map((email) => email.toLowerCase())
  );

  const recipients: string[] = [];

  for (const person of event.attendees ?? []) {
    const identity = person.email.toLowerCase();

    if (!excluded.has(identity)) {
      excluded.add(identity);
      recipients.push(person.email);
    }
  }

  const composition = composeParticipantEmail(event.title ?? "", recipients);

  return composition.kind === "disabled"
    ? composition
    : { href: composition.href, kind: "ready", recipients };
};
