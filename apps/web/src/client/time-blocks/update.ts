import { Option, Schema } from "effect";

import { TimeBlock } from "../../layout/time-blocks.js";
import type { TimeBlockPreferences } from "../../layout/time-blocks.js";
import type { AppModel } from "../app.js";
import { stepTimeBlockEditor } from "./machine.js";
import type { TimeBlockEditor, TimeBlockDraft } from "./model.js";
import {
  TimeBlockAction,
  blankBlockDraft,
  blockDraft,
  blockDraftError,
  validatedBlock,
} from "./model.js";

const sameBlock = Schema.toEquivalence(TimeBlock);

interface Result {
  readonly changed: boolean;
  readonly model: AppModel;
}

export const changeTimeBlocks = (
  model: AppModel,
  action: typeof TimeBlockAction.Type
): Result => {
  const preferences = model.settings.timeBlocks;
  const editor = model.settings.timeBlockEditor;
  const { draft } = editor.context;

  const result = (
    nextEditor: typeof TimeBlockEditor.Type,
    nextPreferences: typeof TimeBlockPreferences.Type = preferences
  ): Result => ({
    changed: nextPreferences !== preferences,
    model: {
      ...model,
      settings: {
        ...model.settings,
        timeBlockEditor: nextEditor,
        timeBlocks: nextPreferences,
      },
    },
  });

  const input = (nextDraft: typeof TimeBlockDraft.Type): Result =>
    result(stepTimeBlockEditor(editor, { draft: nextDraft, type: "INPUT" }));

  return TimeBlockAction.match(action, {
    Add: () => {
      let id = editor.context.sequence;

      for (const block of preferences.blocks) {
        id = Math.max(id, block.id);
      }

      return result(
        stepTimeBlockEditor(editor, {
          draft: blankBlockDraft(id + 1),
          type: "OPEN",
        })
      );
    },
    AddRange: () =>
      input({ ...draft, ranges: [...draft.ranges, { end: "", start: "" }] }),
    Cancel: () => result(stepTimeBlockEditor(editor, { type: "CANCEL" })),
    Color: ({ value }) => input({ ...draft, color: value }),
    Edit: ({ id }) => {
      const block = preferences.blocks.find((candidate) => candidate.id === id);

      return block === undefined
        ? { changed: false, model }
        : result(
            stepTimeBlockEditor(editor, {
              draft: blockDraft(block),
              type: "OPEN",
            })
          );
    },
    Enable: ({ value }) =>
      result(
        editor,
        value === preferences.enabled
          ? preferences
          : { ...preferences, enabled: value }
      ),
    Hidden: ({ value }) => input({ ...draft, hidden: value }),
    Name: ({ value }) => input({ ...draft, name: value }),
    Range: ({ edge, index, value }) =>
      input({
        ...draft,
        ranges: draft.ranges.map((range, position) =>
          position === index ? { ...range, [edge]: value } : range
        ),
      }),
    Remove: ({ id }) => {
      if (!preferences.blocks.some((block) => block.id === id)) {
        return { changed: false, model };
      }

      return result(
        editor.value === "editing" && draft.id === id
          ? stepTimeBlockEditor(editor, { type: "CANCEL" })
          : editor,
        {
          ...preferences,
          blocks: preferences.blocks.filter((block) => block.id !== id),
        }
      );
    },
    RemoveRange: ({ index }) =>
      draft.ranges.length > 1
        ? input({
            ...draft,
            ranges: draft.ranges.filter((_, position) => position !== index),
          })
        : { changed: false, model },
    Save: () => {
      if (editor.value !== "editing") {
        return { changed: false, model };
      }

      const existing = preferences.blocks.find(
        (block) => block.id === draft.id
      );

      const changed = Option.match(draft.original, {
        onNone: () => existing !== undefined,
        onSome: (original) =>
          existing === undefined || !sameBlock(original, existing),
      });

      if (changed) {
        return result(
          stepTimeBlockEditor(editor, {
            message:
              "Time blocks changed while this draft was open. Cancel and reopen it before saving.",
            type: "INVALID",
          })
        );
      }

      return Option.match(validatedBlock(draft), {
        onNone: () =>
          result(
            stepTimeBlockEditor(editor, {
              message: blockDraftError(draft),
              type: "INVALID",
            })
          ),
        onSome: (block) =>
          result(stepTimeBlockEditor(editor, { type: "SAVE" }), {
            ...preferences,
            blocks: preferences.blocks.some(
              (candidate) => candidate.id === block.id
            )
              ? preferences.blocks.map((candidate) =>
                  candidate.id === block.id ? block : candidate
                )
              : [...preferences.blocks, block],
          }),
      });
    },
  });
};
