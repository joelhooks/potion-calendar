import {
  Provider,
  statusEventLabel,
  statusEventType,
} from "@calendar/calendar/contracts";
import type { EventFieldsValue } from "@calendar/calendar/contracts";
import { Effect, Schema } from "effect";

import { hasEditorConferencing } from "./conferencing-draft.js";
import { creationTypeAvailability } from "./create-type-choices.js";
import type { LoadedEditor, EditorFailure } from "./editor-session-model.js";
import { EditorInputFailure } from "./input-failure.js";

export const CreateEventType = Schema.Literals([
  "default",
  "focusTime",
  "outOfOffice",
]);

export const draftStatusAvailability = (
  session: Pick<typeof LoadedEditor.Type, "calendars" | "draft">
) => creationTypeAvailability(session.calendars, session.draft);

const statusDraftProblem = (session: typeof LoadedEditor.Type) =>
  [
    {
      invalid:
        session.draft.attendees.length > 0 ||
        session.draft.participantEmail.trim() !== "" ||
        hasEditorConferencing(session) ||
        session.draft.conferencing?.request?.kind === "googleMeet",
      message:
        "Remove participants and conferencing before choosing Focus time or Out of office.",
    },
    {
      invalid:
        statusEventType(session.draft.eventType) &&
        (session.draft.location.trim() !== "" ||
          session.draft.description.trim() !== "" ||
          (session.draft.attachments?.length ?? 0) > 0),
      message:
        "Start a new Focus time or Out of office event without location, description or attachments.",
    },
  ].find((problem) => problem.invalid)?.message;

export const selectCreateEventType = Effect.fn("selectCreateEventType")(
  function* selectCreateEventType(
    session: typeof LoadedEditor.Type,
    value: string
  ) {
    if (session.kind === "edit") {
      return yield* new EditorInputFailure({
        message:
          "Google doesn't allow changing an event's type after creation.",
      });
    }

    const type = yield* Schema.decodeUnknownEffect(CreateEventType)(value).pipe(
      Effect.mapError(
        () =>
          new EditorInputFailure({
            message: "Choose Event, Focus time or Out of office.",
          })
      )
    );

    const next = {
      ...session,
      draft: {
        ...session.draft,
        eventType: type,
        statusInvitationChoice: undefined,
      },
    };

    if (type !== "default") {
      const availability = draftStatusAvailability(next);
      const problem = statusDraftProblem(next);

      if (availability.kind === "ineligible" || problem !== undefined) {
        return yield* new EditorInputFailure({
          message:
            availability.kind === "ineligible"
              ? availability.reason
              : (problem ?? "This draft cannot use that type."),
        });
      }
    }

    return next;
  }
);

export const creationTypeFields = Effect.fn("creationTypeFields")(
  function* creationTypeFields<Fields extends EventFieldsValue>(
    session: typeof LoadedEditor.Type,
    fields: Fields
  ) {
    if (session.kind === "edit" || !statusEventType(session.draft.eventType)) {
      return fields;
    }

    const availability = draftStatusAvailability(session);
    const problem = statusDraftProblem(session);

    if (availability.kind === "ineligible" || problem !== undefined) {
      return yield* new EditorInputFailure({
        message:
          availability.kind === "ineligible"
            ? availability.reason
            : (problem ?? "This draft cannot use that type."),
      });
    }

    const properties = {
      autoDeclineMode: session.draft.statusInvitationChoice ?? "declineNone",
    };

    return {
      ...fields,
      attendees: [],
      eventType: session.draft.eventType,
      ...(session.draft.eventType === "focusTime"
        ? { focusTimeProperties: properties }
        : { outOfOfficeProperties: properties }),
      transparency: "opaque",
    } satisfies EventFieldsValue;
  }
);

export const statusInsertRefusal = (
  session: Pick<typeof LoadedEditor.Type, "kind" | "draft">,
  failure: typeof EditorFailure.Type | undefined
): string | undefined =>
  session.kind !== "edit" &&
  statusEventType(session.draft.eventType) &&
  Schema.is(Provider)(failure) &&
  failure.operation === "POST" &&
  (failure.status === 400 || failure.status === 403)
    ? `Google didn't accept a ${statusEventLabel(session.draft.eventType)} event for this account. Nothing was created.`
    : undefined;
