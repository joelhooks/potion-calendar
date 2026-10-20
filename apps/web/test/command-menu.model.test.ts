import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import {
  actionScore,
  commandChoices,
  commandSections,
  enterChoice,
  selectedChoice,
  shortcutMatches,
} from "../src/client/keyboard/choices.js";
import { keyboardRegistry, keyHints } from "../src/client/keyboard/registry.js";
import { visibleDays } from "../src/layout/navigation.js";
import { keyboardFixture } from "./keyboard-fixture.js";

it.effect(
  "command matching weights keywords and sorts only inside ordered sections",
  () =>
    Effect.sync(() => {
      const base = keyboardFixture();

      const { model } = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      );

      const empty = commandChoices(model);
      expect(
        empty.map((choice) => commandSections.indexOf(choice.section))
      ).toEqual(
        empty
          .map((choice) => commandSections.indexOf(choice.section))
          .toSorted((a, b) => a - b)
      );

      const filtered = update(
        model,
        Message.KeyboardQuery({ query: "day" })
      ).model;

      const matches = commandChoices(filtered);
      expect(matches.length).toBeGreaterThan(4);

      for (const section of commandSections) {
        const entries = matches.filter((choice) => choice.section === section);
        expect(entries.map((choice) => choice.title)).toEqual(
          entries
            .toSorted(
              (a, b) => b.score - a.score || a.title.localeCompare(b.title)
            )
            .map((choice) => choice.title)
        );
      }

      const create = keyboardRegistry.find((action) => action.id === "create");

      if (create !== undefined) {
        expect(actionScore(create, "create event")).toBe(1);
        expect(actionScore(create, "new meeting")).toBe(0.8);
        expect(actionScore(create, "zzzzzzzzz")).toBe(0);
      }

      expect(
        empty.some((choice) => /notion|clipboard/iu.test(choice.title))
      ).toBe(false);
      expect(empty.map((choice) => choice.id)).toEqual(
        expect.arrayContaining([
          "create",
          "settings",
          "cycle-theme",
          "search-events",
        ])
      );
    })
);

it.effect.prop(
  "keyboard traversal skips disabled choices and wraps without selecting them",
  {
    forward: Schema.Boolean,
    steps: Schema.Int.check(Schema.isBetween({ maximum: 120, minimum: 1 })),
  },
  ({ steps, forward }) =>
    Effect.sync(() => {
      let { model } = update(
        keyboardFixture(false),
        Message.KeyboardAction({ id: "commands" })
      );

      const enabled = commandChoices(model).filter(
        (choice) => !choice.disabled
      );

      const start = selectedChoice(model)?.id;
      const startIndex = enabled.findIndex((choice) => choice.id === start);
      const direction = forward ? 1 : -1;

      for (let step = 0; step < steps; step += 1) {
        ({ model } = update(model, Message.KeyboardMove({ direction })));
        expect(selectedChoice(model)?.disabled).toBe(false);
      }

      expect(selectedChoice(model)?.id).toBe(
        enabled[
          (((startIndex + direction * steps) % enabled.length) +
            enabled.length) %
            enabled.length
        ]?.id
      );
    })
);

it.effect(
  "Return prioritizes exact text over a hovered result; choice actions retain the menu and clear input",
  () =>
    Effect.sync(() => {
      let { model } = update(
        keyboardFixture(),
        Message.KeyboardAction({ id: "commands" })
      );

      ({ model } = update(model, Message.KeyboardQuery({ query: "Day view" })));
      ({ model } = update(model, Message.KeyboardHighlight({ id: "week" })));
      expect(enterChoice(model)?.id).toBe("day");
      const picked = update(model, Message.KeyboardReturn()).model;
      expect(picked.calendar.navigation.mode).toBe("day");
      expect(picked.keyboard.screen).toBe("closed");
      ({ model } = update(
        model,
        Message.KeyboardQuery({ query: "displayed" })
      ));
      ({ model } = update(model, Message.KeyboardPick({ id: "display-days" })));
      expect(model.keyboard.screen).toBe("days");
      expect(model.keyboard.query).toBe("");
      expect(commandChoices(model)).toHaveLength(31);
      ({ model } = update(model, Message.KeyboardQuery({ query: "31" })));
      expect(commandChoices(model).map((choice) => choice.id)).toEqual([
        "display-31",
      ]);
      ({ model } = update(model, Message.KeyboardReturn()));
      expect(model.keyboard.screen).toBe("closed");
      expect(visibleDays(model.calendar.navigation)).toHaveLength(31);
    })
);

it.effect(
  "shortcuts search uses 0.85 similarity or an exact displayed key token",
  () =>
    Effect.sync(() => {
      const title = keyboardRegistry.find(
        (action) => action.id === "edit-title"
      );

      const zoom = keyboardRegistry.find((action) => action.id === "zoom-in");

      if (title !== undefined && zoom !== undefined) {
        expect(shortcutMatches(title, "Edit titlf")).toBe(true);
        expect(shortcutMatches(title, "edit zzzzz")).toBe(false);
        expect(shortcutMatches(title, " E ")).toBe(true);
        expect(shortcutMatches(zoom, ` ${keyHints(zoom)[0]} `)).toBe(true);
      }
    })
);
