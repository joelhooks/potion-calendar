import { createEffectLogic } from "@xstate/effect";
import { Effect, Schema } from "effect";

import { EditorRequest } from "../editing/editor-session-model.js";
import { writableCalendar } from "../editing/load-editor.js";
import {
  ClipboardAnchor,
  ClipboardGuestChoice,
  ClipboardInputFailure,
  ClipboardItem,
  ClipboardPasteTarget,
} from "./model.js";
import { placeClipboardItem } from "./placement.js";
import { prepareClipboardTemplate } from "./template.js";

export const PendingClipboardPaste = Schema.Struct({
  anchor: ClipboardAnchor,
  copyId: Schema.NonEmptyString,
  intentId: Schema.NonEmptyString,
  item: ClipboardItem,
  target: ClipboardPasteTarget,
});

export const ClipboardPreparation = Schema.TaggedUnion({
  Prepared: { request: EditorRequest.cases.New },
  Refused: { failure: ClipboardInputFailure },
});

export const PrepareClipboardInput = Schema.Struct({
  choice: ClipboardGuestChoice,
  pending: PendingClipboardPaste,
});

export const prepareClipboardPaste = Effect.fn("prepareClipboardPaste")(
  function* prepareClipboardPaste(input: typeof PrepareClipboardInput.Type) {
    const { pending } = input;
    const { calendar } = pending.target;

    return yield* Effect.gen(function* prepareOwnedPaste() {
      if (!writableCalendar(calendar)) {
        return yield* new ClipboardInputFailure({
          message: "Choose a writable default calendar before pasting.",
          reason: "noWritableCalendar",
          source: pending.item.source,
        });
      }

      const range = yield* placeClipboardItem(
        pending.item,
        pending.anchor,
        pending.target.primaryZone
      );

      const template = yield* prepareClipboardTemplate(
        pending.item,
        pending.intentId,
        input.choice
      );

      const request = EditorRequest.cases.New.make({
        ...range,
        calendars: [calendar],
        navigation: pending.target.navigation,
        primaryZone: pending.target.primaryZone,
        ref: { accountId: calendar.accountId, calendarId: calendar.calendarId },
        selection: pending.target.selection,
        template,
      });

      return ClipboardPreparation.cases.Prepared.make({ request });
    }).pipe(
      Effect.catchTag("ClipboardInputFailure", (failure) =>
        Effect.succeed(ClipboardPreparation.cases.Refused.make({ failure }))
      )
    );
  }
);

export const prepareClipboardLogic = createEffectLogic({
  effect: ({ input }) => prepareClipboardPaste(input),
  schemas: { input: PrepareClipboardInput },
});
