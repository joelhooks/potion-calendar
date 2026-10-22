import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { BulkView } from "../src/client/bulk/model.js";
import { bulkPlanFor } from "../src/client/bulk/selection.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import { ColorOpening } from "../src/client/keyboard/state.js";
import { finishKeyboardOpening } from "../src/client/keyboard/update.js";
import { Theme } from "../src/client/settings/model.js";
import {
  commandChoiceFixture,
  readyCommandColor,
} from "./command-choice-fixture.js";

const EditingArgs = Schema.Struct({
  command: EditingCommand,
  personId: Schema.String,
});

const editingCommands = (result: ReturnType<typeof update>) =>
  (result.commands ?? [])
    .filter((command) => command.name === "DispatchEditing")
    .map((command) => Schema.decodeUnknownSync(EditingArgs)(command.args));

const open = (model: AppModel, id: string) =>
  update(model, Message.KeyboardAction({ id })).model;

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

it.effect.prop(
  "explicit theme leaves set the chosen value rather than cycle and keep all three choices",
  { before: Theme, target: Theme },
  ({ before, target }) =>
    Effect.sync(() => {
      const base = commandChoiceFixture();

      const model = open(
        { ...base, settings: { ...base.settings, theme: before } },
        "theme"
      );

      expect(commandChoices(model).map((choice) => choice.title)).toEqual([
        "Auto",
        "Light mode",
        "Dark mode",
      ]);

      const result = update(
        model,
        Message.KeyboardPick({ id: `theme-${target}` })
      );

      expect(result.model.settings.theme).toBe(target);
      expect(result.model.keyboard.screen).toBe("closed");
      expect(
        result.commands?.filter((command) => command.name === "SavePreferences")
      ).toHaveLength(1);
      expect(editingCommands(result)).toEqual([]);
      expect(
        commandChoices(open(base, "commands")).some(
          (choice) => choice.id === "cycle-theme"
        )
      ).toBe(false);
      expect(
        keyboardRegistry.find((action) => action.id === "cycle-theme")?.keys
      ).toEqual(["Shift+Mod+l"]);
    })
);

it.effect.prop(
  "week-start choices omit the current value and exact query selection uses the existing settings writer",
  {
    current: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 })),
    offset: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 1 })),
  },
  ({ current, offset }) =>
    Effect.sync(() => {
      const base = commandChoiceFixture();

      const model = open(
        {
          ...base,
          calendar: {
            ...base.calendar,
            navigation: { ...base.calendar.navigation, weekStartsOn: current },
          },
        },
        "week-start"
      );

      const choices = commandChoices(model);
      expect(choices.map((choice) => choice.title)).toEqual(
        weekdays.filter((_, index) => index !== current)
      );
      const target = (current + offset) % 7;
      const label = weekdays[target];

      if (label === undefined) {
        throw new Error("Missing generated weekday");
      }

      const filtered = update(
        model,
        Message.KeyboardQuery({ query: label })
      ).model;

      expect(
        commandChoices(filtered).some(
          (choice) => choice.id === `week-start-${current}`
        )
      ).toBe(false);
      expect(commandChoices(filtered).find((choice) => choice.exact)?.id).toBe(
        `week-start-${target}`
      );

      const result = update(
        filtered,
        Message.KeyboardPick({ id: `week-start-${target}` })
      );

      expect(result.model.calendar.navigation.weekStartsOn).toBe(target);
      expect(result.model.keyboard.screen).toBe("closed");
      expect(
        result.commands?.filter((command) => command.name === "SavePreferences")
      ).toHaveLength(1);
      expect(
        result.commands?.some((command) => command.name === "ReadEvents")
      ).toBe(true);

      const stale = update(
        model,
        Message.KeyboardPick({ id: `week-start-${current}` })
      );

      expect(stale.model).toBe(model);
      expect(stale.commands ?? []).toEqual([]);
    })
);

it.effect.prop(
  "provider colors come only from the selected calendar account and missing palettes retain only calendar color",
  { blue: Schema.Boolean, foreign: Schema.Boolean, red: Schema.Boolean },
  ({ blue, red, foreign }) =>
    Effect.sync(() => {
      const ids = [...(blue ? ["7"] : []), ...(red ? ["11"] : [])];

      const model = open(
        commandChoiceFixture(ids, foreign ? "personal" : "work"),
        "colors"
      );

      expect(commandChoices(model).map((choice) => choice.id)).toEqual([
        "color-calendar",
        ...(red && !foreign ? ["color-11"] : []),
        ...(blue && !foreign ? ["color-7"] : []),
      ]);

      const unsupported = update(
        model,
        Message.KeyboardAction({ id: "color:3" })
      );

      expect(unsupported.model).toBe(model);
      expect(unsupported.commands ?? []).toEqual([]);
    })
);

it.effect.prop(
  "color leaves queue a bound editor intent then stage exactly once without saving",
  { reset: Schema.Boolean },
  ({ reset }) =>
    Effect.sync(() => {
      const base = open(commandChoiceFixture(), "colors");

      const picked = update(
        base,
        Message.KeyboardPick({ id: reset ? "color-calendar" : "color-7" })
      );

      expect(picked.model.keyboard.screen).toBe("closed");
      expect(
        editingCommands(picked).map(({ command }) => command._tag)
      ).toEqual(["Open"]);
      expect(Schema.is(ColorOpening)(picked.model.keyboard.opening)).toBe(true);
      expect(picked.model.keyboard.opening).toMatchObject({
        person: "fixture-person",
        selection: base.calendar.selected[0],
        value: reset ? null : "7",
      });
      const waiting = finishKeyboardOpening(base, picked.model);
      expect(waiting.model.keyboard.opening).toEqual(
        picked.model.keyboard.opening
      );
      expect(waiting.commands ?? []).toEqual([]);

      const initialClosed = {
        ...picked.model,
        editing: {
          ...picked.model.editing,
          owner: picked.model.person,
          view: EditorView.cases.Closed.make({}),
        },
      };

      const stillWaiting = finishKeyboardOpening(picked.model, initialClosed);
      expect(stillWaiting.model.keyboard.opening).toEqual(
        picked.model.keyboard.opening
      );
      expect(stillWaiting.commands ?? []).toEqual([]);

      const loading = {
        ...initialClosed,
        editing: {
          ...initialClosed.editing,
          view: EditorView.cases.Loading.make({
            label: "Loading the selected event",
          }),
        },
      };

      expect(
        finishKeyboardOpening(initialClosed, loading).commands ?? []
      ).toEqual([]);

      const ready = readyCommandColor(loading);
      const staged = finishKeyboardOpening(loading, ready);
      expect(staged.model.keyboard.opening).toBe("none");
      expect(staged.model.keyboard.focus).toBe(
        reset ? "event-color" : "event-color-7"
      );
      expect(editingCommands(staged).map(({ command }) => command)).toEqual([
        EditingCommand.cases.Action.make({
          action: EditorAction.cases.ColorSelected.make({
            value: reset ? null : "7",
          }),
        }),
      ]);
      expect(finishKeyboardOpening(ready, staged.model).commands ?? []).toEqual(
        []
      );

      const again = update(
        {
          ...staged.model,
          keyboard: { ...staged.model.keyboard, screen: "colors" },
        },
        Message.KeyboardPick({ id: "color-11" })
      );

      expect(editingCommands(again).map(({ command }) => command)).toEqual([
        EditingCommand.cases.Action.make({
          action: EditorAction.cases.ColorSelected.make({ value: "11" }),
        }),
      ]);
      expect(again.model.keyboard.opening).toBe("none");
      expect(again.model.keyboard.focus).toBe("event-color-11");
    })
);

it.effect.prop(
  "stale selection, person, session and failed dispatch cancel color intent without replay",
  {
    change: Schema.Literals([
      "selection",
      "person",
      "owner",
      "original",
      "closed",
      "dispatch-failed",
    ]),
  },
  ({ change }) =>
    Effect.sync(() => {
      const base = open(commandChoiceFixture(), "colors");

      const picked = update(
        base,
        Message.KeyboardPick({ id: "color-7" })
      ).model;

      const ready = readyCommandColor(picked);

      if (!EditorView.guards.Editing(ready.editing.view)) {
        throw new Error("Command-color fixture did not reach an editing view");
      }

      let stale = ready;
      let before = picked;

      switch (change) {
        case "selection": {
          stale = { ...ready, calendar: { ...ready.calendar, selected: [] } };
          break;
        }

        case "person": {
          stale = { ...ready, person: Option.some("another-person") };
          break;
        }

        case "owner": {
          stale = {
            ...ready,
            editing: { ...ready.editing, owner: Option.some("another-person") },
          };
          break;
        }

        case "original": {
          stale = {
            ...ready,
            editing: {
              ...ready.editing,
              view: EditorView.cases.Editing.make({
                ...ready.editing.view,
                original: Option.none(),
              }),
            },
          };
          break;
        }

        case "closed": {
          before = {
            ...picked,
            editing: {
              ...picked.editing,
              view: EditorView.cases.Loading.make({
                label: "Loading the selected event",
              }),
            },
          };
          stale = {
            ...ready,
            editing: {
              ...ready.editing,
              view: EditorView.cases.Closed.make({}),
            },
          };
          break;
        }

        case "dispatch-failed": {
          stale = update(
            picked,
            Message.FailedEditing({
              message: "Fixture editor dispatch refused",
            })
          ).model;
          expect(stale.keyboard.opening).toBe("none");
          break;
        }

        default: {
          throw new Error("Unknown stale command-color history");
        }
      }

      const result = finishKeyboardOpening(before, stale);
      expect(result.model.keyboard.opening).toBe("none");
      expect(result.commands ?? []).toEqual([]);
      expect(
        finishKeyboardOpening(result.model, readyCommandColor(result.model))
          .commands ?? []
      ).toEqual([]);
    })
);

it.effect.prop(
  "color eligibility refuses zero, multiple and read-only selections without affecting preference choices",
  {
    kind: Schema.Literals(["none", "multiple", "read-only", "busy", "undoing"]),
  },
  ({ kind }) =>
    Effect.sync(() => {
      const base = commandChoiceFixture();
      let { selected } = base.calendar;

      if (kind === "none") {
        selected = [];
      }

      if (kind === "multiple") {
        selected = [...base.calendar.selected, "another-key"];
      }

      const execution = {
        id: "color-bulk-fixture",
        mutations: [],
        plan: bulkPlanFor(base, "delete", "ordinary"),
        receipts: [],
        selection: base.calendar.selected,
      };

      let { bulk } = base.editing;

      if (kind === "busy") {
        bulk = BulkView.cases.Running.make({
          id: execution.id,
          plan: execution.plan,
          selection: execution.selection,
        });
      }

      if (kind === "undoing") {
        bulk = BulkView.cases.Undoing.make({ execution });
      }

      const model: AppModel = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars:
            kind === "read-only"
              ? base.calendar.calendars.map((calendar) => ({
                  ...calendar,
                  accessRole: "reader",
                }))
              : base.calendar.calendars,
          selected,
        },
        editing: { ...base.editing, bulk },
      };

      expect(
        commandChoices(open(model, "commands")).find(
          (choice) => choice.id === "colors"
        )?.disabled
      ).toBe(true);
      const result = update(model, Message.KeyboardAction({ id: "color:7" }));
      expect(result.commands ?? []).toEqual([]);
      expect(result.model).toBe(model);
      expect(
        commandChoices(open(model, "theme")).every((choice) => !choice.disabled)
      ).toBe(true);
      expect(
        commandChoices(open(model, "week-start")).every(
          (choice) => !choice.disabled
        )
      ).toBe(true);
    })
);
