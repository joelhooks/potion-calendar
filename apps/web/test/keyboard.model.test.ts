import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, initialModel, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { resolveBinding } from "../src/client/keyboard/input.js";
import {
  keyboardRegistry,
  sequencePrefixes,
} from "../src/client/keyboard/registry.js";
import {
  sequenceKey,
  sequenceTimeout,
} from "../src/client/keyboard/sequence.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { ShortcutsRoute } from "../src/layout/route.js";
import { primarySelection } from "../src/layout/selection-set.js";
import { editorViewFields } from "./editor-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import { undoFixture } from "./undo-fixture.js";

const bindings: readonly (readonly [string, string])[] = [
  ["Mod+k", "commands"],
  ["/", "search-events"],
  ["Mod+f", "search-events"],
  ["Mod+j", "join"],
  ["`", "sidebar"],
  ["Mod+\\", "sidebar"],
  ["\\", "context"],
  ["Shift+Mod+\\", "sidebars"],
  ["Escape", "dismiss"],
  ["x", "toggle-selection"],
  ["Delete", "delete"],
  ["Backspace", "delete"],
  ["Shift+Mod+Delete", "delete-no-email"],
  ["Shift+Mod+Backspace", "delete-no-email"],
  ["Shift+Mod+Del", "delete-no-email"],
  ["Mod+d", "duplicate"],
  ["Mod+a", "select-all"],
  ["c", "create"],
  ["r", "refresh"],
  ["n", "next-selection"],
  ["b", "previous-selection"],
  ["Shift+n", "previous-selection"],
  ["e e", "email-participants"],
  ["e t", "edit-title"],
  ["e d", "edit-startDate"],
  ["e z", "edit-timeZone"],
  ["e s", "edit-startTime"],
  ["e q", "edit-endTime"],
  ["e j", "edit-add-meet"],
  ["e c", "edit-calendar"],
  ["e a", "edit-allDay"],
  ["e r", "edit-repeat"],
  ["e p", "edit-participantEmail"],
  ["e l", "edit-location"],
  ["e w", "edit-description"],
  ["e k", "edit-links"],
  ["e h", "edit-reminderInput"],
  ["e y", "rsvp-yes"],
  ["e n", "rsvp-no"],
  ["e m", "rsvp-maybe"],
  ["1", "day"],
  ["d", "day"],
  ["2", "days-2"],
  ["3", "days-3"],
  ["4", "days-4"],
  ["5", "days-5"],
  ["6", "days-6"],
  ["7", "days-7"],
  ["8", "days-8"],
  ["9", "days-9"],
  ["0", "week"],
  ["w", "week"],
  ["m", "month"],
  ["Shift+Mod+e", "weekends"],
  ["Shift+Mod+d", "declined"],
  ["Shift+Mod+a", "all-day"],
  ["Shift+Mod+0", "zoom-reset"],
  ["Shift+Mod+.", "zoom-in"],
  ["Shift+Mod+,", "zoom-out"],
  [".", "go-date"],
  ["t", "today"],
  ["Alt+t", "align-today"],
  ["j", "next"],
  ["k", "previous"],
  ["ArrowRight", "right"],
  ["ArrowLeft", "left"],
  ["ArrowUp", "up"],
  ["ArrowDown", "down"],
  ["?", "shortcuts"],
  ["Shift+Mod+l", "cycle-theme"],
  ["g s", "settings"],
  ["z", "travel-zone"],
  ["Enter", "open-editor"],
];

const inputFor = (token: string) => {
  const parts = token.split("+");

  return {
    alt: parts.includes("Alt"),
    key: parts.at(-1) ?? "",
    mod: parts.includes("Mod"),
    shift: parts.includes("Shift"),
  };
};

const press = (model: AppModel, token: string, now = 100): AppModel =>
  update(model, Message.PressedCalendarKey({ ...inputFor(token), now })).model;

it.effect(
  "every shipped binding resolves through the registry with its intended scope and dispatch",
  () =>
    Effect.sync(() => {
      const base = keyboardFixture();

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: base.calendar.calendars.map((calendar) => ({
            ...calendar,
            allowedConferenceSolutionTypes: ["hangoutsMeet"],
          })),
          navigation: { ...base.calendar.navigation, mode: "month" as const },
        },
      };

      for (const [binding, id] of bindings) {
        const tokens = binding.split(" ");

        const prepared =
          tokens.length === 2 ? press(model, tokens[0] ?? "") : model;

        const match = resolveBinding(
          prepared,
          inputFor(tokens.at(-1) ?? ""),
          101,
          "grid"
        );

        expect(match.action?.id, binding).toBe(id);
        expect(match.action?.availability(prepared), binding).toBe("enabled");
        expect(match.action?.dispatch(prepared)).toBeDefined();
        const signedOut = initialModel(model.calendar.now, "UTC");
        expect(
          resolveBinding(signedOut, inputFor(tokens.at(-1) ?? ""), 101, "grid")
            .action,
          binding
        ).toBeUndefined();
      }

      const shortcuts = {
        ...base,
        route: ShortcutsRoute.make({ section: Option.none() }),
      };

      const localSearch = resolveBinding(
        shortcuts,
        inputFor("Mod+f"),
        101,
        "text"
      ).action;

      expect(localSearch?.id).toBe("focus-shortcuts");
      expect(localSearch?.dispatch(shortcuts)).toEqual(
        Message.KeyboardAction({ id: "focus-shortcuts" })
      );

      const open = {
        ...base,
        editing: {
          ...base.editing,
          view: EditorView.cases.Editing.make(editorViewFields),
        },
      };

      for (const key of ["Enter", "Mod+Enter", "Shift+Mod+Enter"]) {
        expect(
          resolveBinding(open, inputFor(key), 0, "dialog").action?.id
        ).toBe(key === "Shift+Mod+Enter" ? "save-no-email" : "confirm");
      }

      const { pending } = undoFixture();
      const undo = resolveBinding(pending, inputFor("Mod+z"), 0, "grid").action;
      expect(undo?.id).toBe("undo");

      const undoResult = update(
        pending,
        undo?.dispatch(pending) ?? Message.Navigated()
      );

      expect(undoResult.commands?.map((command) => command.name)).toEqual([
        "DispatchEditing",
      ]);

      const expected = [
        ...bindings.map(([key]) => key),
        "Mod+f",
        "Mod+z",
        "Enter",
        "Mod+Enter",
        "Shift+Mod+Enter",
      ].toSorted();

      expect(
        keyboardRegistry.flatMap((action) => action.keys).toSorted()
      ).toEqual(expected);
    })
);

it.effect.prop(
  "sequence deadlines are exclusive and cannot turn a late N into RSVP",
  { gap: Schema.Int.check(Schema.isBetween({ maximum: 3000, minimum: 0 })) },
  ({ gap }) =>
    Effect.sync(() => {
      const first = sequenceKey(
        { deadline: 0, prefix: "" },
        "e",
        20,
        sequencePrefixes()
      );

      expect(
        sequenceKey(first, "n", 20 + sequenceTimeout, sequencePrefixes()).token
      ).toBe("n");
      const second = sequenceKey(first, "n", 20 + gap, sequencePrefixes());
      expect(second.token).toBe(gap < sequenceTimeout ? "e n" : "n");
      expect(second.prefix).toBe("");
      expect(sequenceKey(first, "Escape", 21, sequencePrefixes()).token).toBe(
        "Escape"
      );
      expect(
        press(press(keyboardFixture(), "e", 20), "n", 20 + gap).keyboard.prefix
      ).toBe("");
    })
);

it.effect.prop(
  "K8 J/K moves a single day, a multi-day week, or a month without changing the displayed mode",
  {
    count: Schema.Int.check(Schema.isBetween({ maximum: 31, minimum: 1 })),
    forward: Schema.Boolean,
  },
  ({ count, forward }) =>
    Effect.sync(() => {
      const base = keyboardFixture();
      const anchor = dayFromIso("2026-10-19");
      const direction = forward ? 1 : -1;

      for (const mode of ["day", "days", "week", "month"] as const) {
        const model = {
          ...base,
          calendar: {
            ...base.calendar,
            navigation: { anchor, days: count, hideWeekends: false, mode },
          },
        };

        const next = press(model, forward ? "j" : "k");

        const expected =
          mode === "month"
            ? dayFromIso(forward ? "2026-11-01" : "2026-09-01")
            : anchor +
              direction *
                (mode === "day" || (mode === "days" && count === 1) ? 1 : 7);

        expect(next.calendar.navigation.anchor).toBe(expected);
        expect(next.calendar.navigation.mode).toBe(mode);
      }
    })
);

it.effect(
  "permissions and text scopes never turn unavailable editing into browser interception",
  () =>
    Effect.sync(() => {
      const readonly = keyboardFixture(false);

      const noSelection = {
        ...readonly,
        calendar: { ...readonly.calendar, selected: [] },
      };

      expect(
        keyboardRegistry
          .find((action) => action.id === "edit-title")
          ?.availability(readonly)
      ).toBe("disabled");
      expect(
        keyboardRegistry
          .find((action) => action.id === "edit-title")
          ?.availability(noSelection)
      ).toBe("hidden");
      expect(
        resolveBinding(readonly, inputFor("Mod+z"), 0, "grid").action
      ).toBeUndefined();
      expect(
        resolveBinding(noSelection, inputFor("Mod+d"), 0, "grid").action
      ).toBeUndefined();

      for (const token of [
        "c",
        "n",
        "t",
        "Delete",
        "Mod+d",
        "Mod+z",
        "Enter",
      ]) {
        expect(
          resolveBinding(readonly, inputFor(token), 0, "text").action
        ).toBeUndefined();
      }

      const selected = press(noSelection, "n");
      const deselected = press(selected, "x");
      expect(
        Option.isNone(primarySelection(deselected.calendar.selected))
      ).toBe(true);
      expect(press(deselected, "x").calendar.selected).toEqual(
        selected.calendar.selected
      );
      expect(press(selected, "Escape").calendar.selected).toEqual([]);
    })
);
