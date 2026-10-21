import { createEffectLogic } from "@xstate/effect";
import { Effect, Schema } from "effect";

import { readFailure } from "../calendar-state.js";
import { CalendarEditingClient } from "../editing/calendar-client.js";
import { captureClipboardItem } from "./capture.js";
import type { ClipboardItem } from "./model.js";
import {
  ClipboardCaptureResult,
  ClipboardEnvelope,
  ClipboardInputFailure,
  NativeClipboardNotice,
} from "./model.js";

export const HydratedCopy = Schema.TaggedUnion({
  Ready: { notice: NativeClipboardNotice.cases.Copied },
  Refused: { failure: ClipboardInputFailure },
});

export const hydrateCopy = Effect.fn("hydrateClipboardCopy")(
  function* hydrateCopy(
    notice: typeof NativeClipboardNotice.cases.Copied.Type
  ) {
    const client = yield* CalendarEditingClient;
    const items: (typeof ClipboardItem.Type)[] = [];

    for (const item of notice.envelope.items) {
      if (item.creationFields.attachments !== undefined) {
        items.push(item);
        continue;
      }

      const event = yield* client.getEvent(item.source).pipe(
        Effect.mapError(
          (failure) =>
            new ClipboardInputFailure({
              message: `Could not read this event from Google (${failure._tag}). ${readFailure(failure).message} Nothing was ${notice.mode === "cut" ? "cut" : "copied"}.`,
              reason: "unsupportedEvent",
              source: item.source,
            })
        )
      );

      const captured = captureClipboardItem(event, notice.selfEmails ?? []);

      if (ClipboardCaptureResult.guards.Refused(captured)) {
        return yield* captured.failure;
      }

      if (captured.item.creationFields.attachments === undefined) {
        return yield* new ClipboardInputFailure({
          message:
            "The event read did not confirm an attachment list. Nothing was copied or cut. Reload the app and try again.",
          reason: "unsupportedEvent",
          source: item.source,
        });
      }

      items.push(captured.item);
    }

    const [first, ...rest] = items;

    if (first === undefined) {
      return yield* Effect.die(
        new Error("A validated clipboard envelope lost every member")
      );
    }

    return HydratedCopy.cases.Ready.make({
      notice: {
        ...notice,
        envelope: ClipboardEnvelope.make({
          ...notice.envelope,
          items: [first, ...rest],
        }),
      },
    });
  },
  Effect.catchTag("ClipboardInputFailure", (failure) =>
    Effect.succeed(HydratedCopy.cases.Refused.make({ failure }))
  )
);

export const hydrateCopyLogic = createEffectLogic({
  effect: ({ input }) => hydrateCopy(input),
  schemas: { input: NativeClipboardNotice.cases.Copied },
});
