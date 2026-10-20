import type {
  ConferencingDefault,
  ConferencingRequestValue,
} from "./conferencing-model.js";
import type { Attendee } from "./model.js";

export interface ConferencingDefaultFacts {
  readonly attendees: readonly (typeof Attendee.Type)[];
  readonly hasConferencing: boolean;
  readonly isNew: boolean;
  readonly participantSeen: boolean;
  readonly request: ConferencingRequestValue | undefined;
  readonly selfEmail: string | undefined;
  readonly setting: typeof ConferencingDefault.Type | undefined;
}

export interface ConferencingDefaultTransition {
  readonly participantSeen: boolean;
  readonly request: ConferencingRequestValue | undefined;
}

export const automaticConferencingRequest = (
  facts: ConferencingDefaultFacts
): ConferencingDefaultTransition => {
  const selfEmail = facts.selfEmail?.trim().toLowerCase();

  const eligible = facts.attendees.some(
    (attendee) =>
      attendee.resource !== true &&
      attendee.self !== true &&
      attendee.email.trim().toLowerCase() !== selfEmail
  );

  return {
    participantSeen: facts.participantSeen || eligible,
    request:
      facts.request ??
      (facts.isNew &&
      eligible &&
      !facts.participantSeen &&
      !facts.hasConferencing &&
      facts.setting === "googleMeet"
        ? { kind: "googleMeet" }
        : undefined),
  };
};
