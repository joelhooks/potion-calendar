import type { CalendarEventValue } from "@calendar/calendar/contracts";

import { ordinaryLink } from "./event-links.js";

export type ParticipantEmail =
  | {
      readonly kind: "ready";
      readonly href: string;
      readonly recipients: readonly string[];
    }
  | { readonly kind: "disabled"; readonly reason?: string };

const wellFormed = (value: string): boolean => {
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;

    if (point >= 0xd8_00 && point <= 0xdf_ff) {
      return false;
    }
  }

  return true;
};

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

  if (recipients.length === 0) {
    return { kind: "disabled" };
  }

  if (
    !wellFormed(event.title ?? "") ||
    recipients.some((email) => !wellFormed(email))
  ) {
    return { kind: "disabled" };
  }

  const href = `mailto:${recipients.map((email) => encodeURIComponent(email).replaceAll("%40", "@")).join(",")}?subject=${encodeURIComponent(event.title ?? "")}`;

  if (href.length > 2000) {
    return { kind: "disabled", reason: "Too many guests to email from here." };
  }

  return ordinaryLink(href) === undefined
    ? { kind: "disabled" }
    : { href, kind: "ready", recipients };
};
