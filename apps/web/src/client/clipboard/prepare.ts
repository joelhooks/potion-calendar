import { createEffectLogic } from "@xstate/effect";
import { Effect, Result, Schema } from "effect";

import {
  planRelativeClipboard,
  RelativeClipboardPlan,
} from "../../layout/relative-clipboard.js";
import { SelectionClipboardSnapshot } from "../../layout/selection-clipboard.js";
import { EditorRequest } from "../editing/editor-session-model.js";
import { writableCalendar } from "../editing/load-editor.js";
import {
  ClipboardGroupPreparation,
  ClipboardGroupRequest,
} from "./group-model.js";
import {
  ClipboardAnchor,
  ClipboardGuestChoice,
  ClipboardInputFailure,
  ClipboardItem,
  ClipboardPasteTarget,
} from "./model.js";
import type { ClipboardMemberIssue } from "./model.js";
import { placeClipboardItem } from "./placement.js";
import { prepareClipboardTemplate } from "./template.js";

export const PendingClipboardPaste = Schema.Struct({
  anchor: ClipboardAnchor,
  copyId: Schema.NonEmptyString,
  group: Schema.optional(SelectionClipboardSnapshot),
  intentId: Schema.NonEmptyString,
  item: ClipboardItem,
  target: ClipboardPasteTarget,
});

export const ClipboardPreparation = Schema.TaggedUnion({
  Prepared: { request: EditorRequest.cases.New },
  PreparedGroup: ClipboardGroupPreparation.fields,
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

      if (pending.group !== undefined) {
        if (
          input.choice === "includeAndEmail" &&
          pending.group.members.some((member) => !member.item.guestsComplete)
        ) {
          return yield* new ClipboardInputFailure({
            message:
              "The group's guest lists are incomplete. Paste without guests instead.",
            reason: "incompleteGuests",
          });
        }

        const plan = yield* planRelativeClipboard({
          anchor: pending.anchor,
          homeZone: pending.target.primaryZone,
          personId: pending.group.personId,
          refusalPresentation: pending.target.refusalPresentation,
          snapshot: pending.group,
        });

        if (RelativeClipboardPlan.guards.Refused(plan)) {
          return yield* new ClipboardInputFailure({
            message: plan.issues
              .map((issue) => `${issue.title}: ${issue.message}`)
              .join("\n"),
            reason: plan.issues.some((issue) => issue.reason === "mixedRanges")
              ? "mixedRanges"
              : "invalidRange",
          });
        }

        const issues: (typeof ClipboardMemberIssue.Type)[] = plan.issues.map(
          (issue) => ({
            key: issue.key,
            reason: issue.message,
            sentence:
              issue.reason === "unsafeLocalTime" ? issue.message : undefined,
            title: issue.title,
          })
        );

        const requests: (typeof ClipboardGroupRequest.Type)[] = [];

        for (const [index, step] of plan.steps.entries()) {
          const template = yield* prepareClipboardTemplate(
            step.item,
            `${pending.intentId}.member.${index}`,
            input.choice
          ).pipe(Effect.result);

          if (Result.isFailure(template)) {
            issues.push({
              key: step.key,
              reason: template.failure.message,
              title: step.item.content.title,
            });
            continue;
          }

          requests.push(
            ClipboardGroupRequest.make({
              key: step.key,
              request: EditorRequest.cases.New.make({
                ...step.placement,
                calendars: [calendar],
                conferencingContext: pending.target.conferencingContext,
                navigation: pending.target.navigation,
                primaryZone: pending.target.primaryZone,
                ref: {
                  accountId: calendar.accountId,
                  calendarId: calendar.calendarId,
                },
                selection: pending.target.selection,
                template: template.success,
              }),
              title: step.item.content.title,
            })
          );
        }

        return ClipboardPreparation.cases.PreparedGroup.make({
          issues,
          requests,
        });
      }

      const range = yield* placeClipboardItem(
        pending.item,
        pending.anchor,
        pending.target.primaryZone,
        pending.target.refusalPresentation
      );

      const template = yield* prepareClipboardTemplate(
        pending.item,
        pending.intentId,
        input.choice
      );

      const request = EditorRequest.cases.New.make({
        ...range,
        calendars: [calendar],
        conferencingContext: pending.target.conferencingContext,
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
