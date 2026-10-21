import {
  statusEventProperties,
  statusEventType,
  supportedStatusInvitationMode,
} from "@calendar/calendar/contracts";
import { Effect, Option } from "effect";

import type { ScopeOffer } from "../../layout/edit-scope.js";
import type { LoadedEditor } from "./editor-session-model.js";
import { EditorInputFailure } from "./input-failure.js";

export const allConflictingPolicyMessage =
  "Google is set to decline all conflicting invitations. Change this in Google Calendar.";

export const statusPolicyUnavailable = (
  session: Pick<
    typeof LoadedEditor.Type,
    "kind" | "draft" | "original" | "calendars"
  >,
  editable: boolean
): string | undefined => {
  const source = Option.getOrUndefined(session.original);

  const mode =
    source === undefined
      ? undefined
      : statusEventProperties(source)?.autoDeclineMode;

  const calendar = session.calendars.find(
    (item) =>
      item.accountId === session.draft.accountId &&
      item.calendarId === session.draft.calendarId
  );

  const saved = session.kind === "edit";

  const owned =
    calendar?.accessRole === "owner" &&
    calendar.primary &&
    source?.organizer?.self === true &&
    source.eventType === session.draft.eventType;

  return [
    {
      blocked: !statusEventType(session.draft.eventType) || !editable,
      message: "Google doesn't permit editing this invitation policy.",
    },
    {
      blocked: saved && mode === "declineAllConflictingInvitations",
      message: allConflictingPolicyMessage,
    },
    {
      blocked: saved && !supportedStatusInvitationMode(mode),
      message:
        "Google didn't provide this event's invitation policy. Change this in Google Calendar.",
    },
    {
      blocked: saved && !owned,
      message: "Google doesn't permit editing this invitation policy.",
    },
  ].find((entry) => entry.blocked)?.message;
};

export const statusPolicyChanged = (
  session: Pick<typeof LoadedEditor.Type, "draft" | "baseline">
) =>
  session.draft.statusInvitationChoice !==
  session.baseline.statusInvitationChoice;

export const validateStatusPolicyDraft = Effect.fn("validateStatusPolicyDraft")(
  function* validateStatusPolicyDraft(
    session: typeof LoadedEditor.Type,
    editable: boolean
  ) {
    if (session.kind !== "edit" || !statusPolicyChanged(session)) {
      return yield* Effect.void;
    }

    const reason = statusPolicyUnavailable(session, editable);

    if (
      reason !== undefined ||
      !supportedStatusInvitationMode(session.draft.statusInvitationChoice)
    ) {
      return yield* new EditorInputFailure({
        message: reason ?? "Choose a supported invitation policy.",
      });
    }

    return yield* Effect.void;
  }
);

export const statusPolicyScopes = (
  offer: ScopeOffer,
  session: typeof LoadedEditor.Type
): ScopeOffer => {
  if (session.kind !== "edit" || !statusPolicyChanged(session)) {
    return offer;
  }

  const choices = offer.choices.filter((scope) => scope !== "allFollowing");

  return {
    ...offer,
    choices,
    defaultScope: choices[0],
    prompt: choices.length === 0 ? "unavailable" : offer.prompt,
  };
};
