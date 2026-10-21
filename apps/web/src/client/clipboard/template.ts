import { Attendee } from "@calendar/calendar/contracts";
import type { EventFieldsValue } from "@calendar/calendar/contracts";
import { Effect, Schema } from "effect";

import type { EventDraftValue } from "../editing/editor-model.js";
import type {
  ClipboardCreationFields,
  ClipboardGuestChoice,
  ClipboardItem,
} from "./model.js";
import {
  ClipboardInputFailure,
  ClipboardPasteMetadata,
  ClipboardTemplate,
} from "./model.js";

export const prepareClipboardTemplate = Effect.fn("prepareClipboardTemplate")(
  function* prepareClipboardTemplate(
    item: typeof ClipboardItem.Type,
    intentId: string,
    choice: typeof ClipboardGuestChoice.Type
  ) {
    if (item.creationFields.attachments === undefined) {
      return yield* new ClipboardInputFailure({
        message:
          "This saved clipboard snapshot has no confirmed attachment list. Duplicate the source event instead.",
        reason: "unsupportedEvent",
        source: item.source,
      });
    }

    if (choice === "includeAndEmail" && !item.guestsComplete) {
      return yield* new ClipboardInputFailure({
        message:
          "The source guest list is incomplete. Paste without guests instead.",
        reason: "incompleteGuests",
        source: item.source,
      });
    }

    const guestChoice =
      choice === "includeAndEmail" && item.guests.length > 0
        ? "includeAndEmail"
        : "exclude";

    return yield* Schema.decodeEffect(ClipboardTemplate)({
      content: item.content,
      creationFields: item.creationFields,
      guestChoice,
      guests: guestChoice === "includeAndEmail" ? item.guests : [],
      intentId,
    }).pipe(
      Effect.mapError(
        () =>
          new ClipboardInputFailure({
            message: "This copied event cannot be prepared for creation.",
            reason: "invalidTemplate",
            source: item.source,
          })
      )
    );
  }
);

export const composeClipboardDraft = (
  draft: EventDraftValue,
  template: typeof ClipboardTemplate.Type
): EventDraftValue => ({
  ...draft,
  attachments: template.creationFields.attachments,
  attendees:
    template.guestChoice === "includeAndEmail"
      ? template.guests.map((guest) =>
          Attendee.make({
            ...guest,
            responseStatus: "needsAction",
          })
        )
      : [],
  colorId: template.content.colorId,
  description: template.content.description,
  location: template.content.location,
  reminders: template.content.reminders,
  title: template.content.title,
});

export const clipboardSendUpdates = (
  template: typeof ClipboardTemplate.Type
): "all" | "none" =>
  template.guestChoice === "includeAndEmail" && template.guests.length > 0
    ? "all"
    : "none";

export const clipboardPasteMetadata = (
  template: typeof ClipboardTemplate.Type
) =>
  ClipboardPasteMetadata.make({
    creationFields: template.creationFields,
    intentId: template.intentId,
    sendUpdates: clipboardSendUpdates(template),
  });

type ClipboardCreationMerge<Fields extends EventFieldsValue> =
  Fields extends EventFieldsValue
    ? Omit<Fields, keyof typeof ClipboardCreationFields.Type> &
        typeof ClipboardCreationFields.Type & {
          readonly attachments: EventFieldsValue["attachments"];
        }
    : never;

export function composeClipboardCreationFields<Fields extends EventFieldsValue>(
  fields: Fields,
  template: Pick<typeof ClipboardTemplate.Type, "creationFields">
): ClipboardCreationMerge<Fields>;
export function composeClipboardCreationFields(
  fields: EventFieldsValue,
  template: Pick<typeof ClipboardTemplate.Type, "creationFields">
): EventFieldsValue {
  const copied = template.creationFields;

  return {
    ...fields,
    attachments: copied.attachments ?? fields.attachments,
    guestsCanInviteOthers:
      copied.guestsCanInviteOthers ?? fields.guestsCanInviteOthers,
    guestsCanModify: copied.guestsCanModify ?? fields.guestsCanModify,
    guestsCanSeeOtherGuests:
      copied.guestsCanSeeOtherGuests ?? fields.guestsCanSeeOtherGuests,
    transparency: copied.transparency ?? fields.transparency,
    visibility: copied.visibility ?? fields.visibility,
  };
}
