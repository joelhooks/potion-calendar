import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import type { AppModel } from "../src/client/app.js";
import { Message, update } from "../src/client/app.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { TimeBlockAction } from "../src/client/time-blocks/model.js";
import { changeTimeBlocks } from "../src/client/time-blocks/update.js";
import { TimeBlock, TimeBlockPreferences } from "../src/layout/time-blocks.js";
import { timeBlockModel } from "./time-block-fixture.js";

type Block = typeof TimeBlock.Type;

const operation = Schema.Literals([
  "add",
  "edit",
  "name",
  "range",
  "invalid",
  "save",
  "cancel",
  "remove",
  "enable",
  "hidden",
  "color",
  "addRange",
  "removeRange",
]);

it.effect.prop(
  "time-block edit histories commit only valid explicit drafts and Cancel never writes",
  { operations: Schema.Array(operation) },
  ({ operations }) =>
    Effect.sync(() => {
      let model = timeBlockModel("settings-empty");
      let stored: Block[] = [];
      let enabled = false;
      let editing = false;
      let sequence = 0;

      let draft = {
        color: "#7d8d85",
        hidden: false,
        id: 0,
        name: "",
        ranges: [{ endMinute: 0, startMinute: 0 }],
      };

      const setup: readonly (typeof operation.Type)[] = [
        "add",
        "name",
        "range",
        "save",
      ];

      let expectedWrite = false;

      const actions = {
        add: () => {
          if (!editing) {
            sequence += 1;
            draft = {
              color: "#7d8d85",
              hidden: false,
              id: sequence,
              name: "",
              ranges: [{ endMinute: 0, startMinute: 0 }],
            };
            editing = true;
          }

          return TimeBlockAction.cases.Add.make({});
        },
        addRange: () => {
          if (editing) {
            draft = {
              ...draft,
              ranges: [...draft.ranges, { endMinute: 0, startMinute: 0 }],
            };
          }

          return TimeBlockAction.cases.AddRange.make({});
        },
        cancel: () => {
          editing = false;

          return TimeBlockAction.cases.Cancel.make({});
        },
        color: () => {
          if (editing) {
            draft = { ...draft, color: "#4986e8" };
          }

          return TimeBlockAction.cases.Color.make({ value: "#4986e8" });
        },
        edit: () => {
          const [first] = stored;

          if (!editing && first !== undefined) {
            draft = {
              ...first,
              ranges: first.ranges.map((range) => ({ ...range })),
            };
            editing = true;
          }

          return TimeBlockAction.cases.Edit.make({ id: first?.id ?? -1 });
        },
        enable: () => {
          enabled = !enabled;
          expectedWrite = true;

          return TimeBlockAction.cases.Enable.make({ value: enabled });
        },
        hidden: () => {
          if (editing) {
            draft = { ...draft, hidden: true };
          }

          return TimeBlockAction.cases.Hidden.make({ value: true });
        },
        invalid: () => {
          if (editing) {
            draft = {
              ...draft,
              ranges: draft.ranges.map((range, index) =>
                index === 0 ? { ...range, endMinute: 0 } : range
              ),
            };
          }

          return TimeBlockAction.cases.Range.make({
            edge: "end",
            index: 0,
            value: "bad",
          });
        },
        name: () => {
          if (editing) {
            draft = { ...draft, name: "Explicit block" };
          }

          return TimeBlockAction.cases.Name.make({ value: "Explicit block" });
        },
        range: () => {
          if (editing) {
            draft = {
              ...draft,
              ranges: draft.ranges.map((range, index) =>
                index === 0 ? { endMinute: 1440, startMinute: 0 } : range
              ),
            };
          }

          ({ model } = changeTimeBlocks(
            model,
            TimeBlockAction.cases.Range.make({
              edge: "start",
              index: 0,
              value: "00:00",
            })
          ));

          return TimeBlockAction.cases.Range.make({
            edge: "end",
            index: 0,
            value: "24:00",
          });
        },
        remove: () => {
          const [first] = stored;

          if (first !== undefined) {
            stored = stored.filter((block) => block.id !== first.id);
            expectedWrite = true;

            if (editing && draft.id === first.id) {
              editing = false;
            }
          }

          return TimeBlockAction.cases.Remove.make({ id: first?.id ?? -1 });
        },
        removeRange: () => {
          if (editing && draft.ranges.length > 1) {
            draft = { ...draft, ranges: draft.ranges.slice(0, -1) };
          }

          return TimeBlockAction.cases.RemoveRange.make({
            index:
              model.settings.timeBlockEditor.context.draft.ranges.length - 1,
          });
        },
        save: () => {
          if (
            editing &&
            draft.name.length > 0 &&
            draft.ranges.every((range) => range.endMinute > range.startMinute)
          ) {
            const block = {
              ...draft,
              ranges: draft.ranges.map((range) => ({ ...range })),
            };

            stored = stored.some((existing) => existing.id === block.id)
              ? stored.map((existing) =>
                  existing.id === block.id ? block : existing
                )
              : [...stored, block];
            editing = false;
            expectedWrite = true;
          }

          return TimeBlockAction.cases.Save.make({});
        },
      };

      for (const step of [...setup, ...operations]) {
        expectedWrite = false;
        const action = actions[step]();
        const result = changeTimeBlocks(model, action);
        ({ model } = result);
        expect(result.changed).toBe(expectedWrite);
        expect(model.settings.timeBlocks).toEqual({ blocks: stored, enabled });
        expect(model.settings.timeBlockEditor.value).toBe(
          editing ? "editing" : "closed"
        );
        expect(model.settings.timeBlockEditor.context.sequence).toBe(sequence);
      }
    })
);

const send = (model: AppModel, action: typeof TimeBlockAction.Type) =>
  update(
    model,
    Message.ChangedTimeBlocks({
      action,
      personId: Option.getOrThrow(model.person),
    })
  );

it.effect(
  "root Settings validates before one person-scoped write, ignores stale people and retains incomplete input until Cancel",
  () =>
    Effect.sync(() => {
      let model = timeBlockModel("settings-empty");
      const initial = model.settings.timeBlocks;
      ({ model } = send(model, TimeBlockAction.cases.Add.make({})));
      const invalid = send(model, TimeBlockAction.cases.Save.make({}));
      expect(
        invalid.commands?.some(
          (command) => command.name === "SavePreferences"
        ) ?? false
      ).toBe(false);
      expect(invalid.model.settings.timeBlocks).toEqual(initial);
      expect(
        Option.isSome(invalid.model.settings.timeBlockEditor.context.error)
      ).toBe(true);
      ({ model } = invalid);

      for (const action of [
        TimeBlockAction.cases.Name.make({ value: "  Evening  " }),
        TimeBlockAction.cases.Range.make({
          edge: "start",
          index: 0,
          value: "21:00",
        }),
        TimeBlockAction.cases.Range.make({
          edge: "end",
          index: 0,
          value: "24:00",
        }),
        TimeBlockAction.cases.Hidden.make({ value: true }),
      ]) {
        ({ model } = send(model, action));
      }

      const saved = send(model, TimeBlockAction.cases.Save.make({}));

      const writes =
        saved.commands?.filter(
          (command) => command.name === "SavePreferences"
        ) ?? [];

      expect(writes).toHaveLength(1);
      expect(writes[0]?.args).toMatchObject({
        ...preferenceSnapshot(saved.model),
        person: Option.getOrThrow(model.person),
      });
      expect(saved.model.settings.timeBlocks.blocks[0]).toMatchObject({
        hidden: true,
        name: "Evening",
        ranges: [{ endMinute: 1440, startMinute: 1260 }],
      });
      expect(saved.model.settings.timeBlocks.enabled).toBe(false);

      const stale = update(
        saved.model,
        Message.ChangedTimeBlocks({
          action: TimeBlockAction.cases.Enable.make({ value: true }),
          personId: "not-this-person",
        })
      );

      expect(stale.model).toBe(saved.model);

      const editing = send(
        saved.model,
        TimeBlockAction.cases.Edit.make({ id: 1 })
      );

      const cancelled = send(
        editing.model,
        TimeBlockAction.cases.Cancel.make({})
      );

      expect(cancelled.model.settings.timeBlocks).toEqual(
        saved.model.settings.timeBlocks
      );
      expect(
        cancelled.commands?.some(
          (command) => command.name === "SavePreferences"
        ) ?? false
      ).toBe(false);
    })
);

it.effect(
  "a late preference read cannot turn an unfinished Add draft into an overwrite of an existing saved block",
  () =>
    Effect.sync(() => {
      let model = timeBlockModel("settings-empty");

      for (const action of [
        TimeBlockAction.cases.Add.make({}),
        TimeBlockAction.cases.Name.make({ value: "New draft" }),
        TimeBlockAction.cases.Range.make({
          edge: "start",
          index: 0,
          value: "10:00",
        }),
        TimeBlockAction.cases.Range.make({
          edge: "end",
          index: 0,
          value: "11:00",
        }),
      ]) {
        ({ model } = send(model, action));
      }

      const stored = {
        color: "#4986e8",
        hidden: false,
        id: 1,
        name: "Previously saved",
        ranges: [{ endMinute: 600, startMinute: 480 }],
      };

      const preferences = {
        ...preferenceSnapshot(model),
        timeBlocks: { blocks: [stored], enabled: false },
      };

      ({ model } = update(
        model,
        Message.ReceivedPreferences({
          person: Option.getOrThrow(model.person),
          preferences,
        })
      ));
      const result = send(model, TimeBlockAction.cases.Save.make({}));
      expect(result.model.settings.timeBlocks.blocks).toEqual([stored]);
      expect(result.model.settings.timeBlockEditor.context.draft.name).toBe(
        "New draft"
      );
      expect(
        Option.getOrUndefined(
          result.model.settings.timeBlockEditor.context.error
        )
      ).toContain("changed while this draft was open");
      expect(
        result.commands?.some(
          (command) => command.name === "SavePreferences"
        ) ?? false
      ).toBe(false);
    })
);

it.effect(
  "stored block schemas reject inverted ranges, empty names and duplicate identities without guessing a replacement schedule",
  () =>
    Effect.sync(() => {
      const valid = {
        color: "#7d8d85",
        hidden: true,
        id: 1,
        name: "Explicit",
        ranges: [{ endMinute: 1440, startMinute: 0 }],
      };

      for (const invalid of [
        { ...valid, name: " " },
        { ...valid, color: "red;position:fixed" },
        { ...valid, ranges: [] },
        { ...valid, ranges: [{ endMinute: 60, startMinute: 1320 }] },
        { ...valid, ranges: [{ endMinute: 60, startMinute: 60 }] },
        { ...valid, ranges: [{ endMinute: 1441, startMinute: 0 }] },
      ]) {
        expect(Option.isNone(Schema.decodeOption(TimeBlock)(invalid))).toBe(
          true
        );
      }

      expect(
        Option.isNone(
          Schema.decodeOption(TimeBlockPreferences)({
            blocks: [valid, valid],
            enabled: true,
          })
        )
      ).toBe(true);
    })
);
