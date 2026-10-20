import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { ReadPreferences, SavePreferences } from "../src/client/commands.js";
import { keyboardMessage } from "../src/client/keyboard/input.js";
import {
  normalizePreferences,
  StoredPreferences,
} from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { view } from "../src/features/app.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { keyboardFixture } from "./keyboard-fixture.js";
import { meetingModel, savedMeeting } from "./meetings-fixture.js";

it.effect.prop(
  "panel histories preserve event authority and save only changes to context visibility",
  {
    actions: Schema.Array(
      Schema.Literals(["sidebar", "context", "sidebars", "show-context"])
    ).check(Schema.isMaxLength(30)),
    left: Schema.Boolean,
    right: Schema.Boolean,
  },
  ({ actions, left, right }) =>
    Effect.sync(() => {
      const base = keyboardFixture();

      let model = {
        ...base,
        keyboard: { ...base.keyboard, sidebar: left },
        settings: { ...base.settings, hideContextPanel: !right },
      };

      let calendarShown = left;
      let contextShown = right;

      for (const id of actions) {
        const previousContext = contextShown;
        const previous = model;

        if (id === "sidebar") {
          calendarShown = !calendarShown;
        } else if (id === "context") {
          contextShown = !contextShown;
        } else if (id === "show-context") {
          contextShown = true;
        } else {
          const bothShown = calendarShown && contextShown;
          calendarShown = !bothShown;
          contextShown = !bothShown;
        }

        const result = update(model, Message.KeyboardAction({ id }));
        ({ model } = result);

        expect(model.keyboard.sidebar).toBe(calendarShown);
        expect(model.settings.hideContextPanel).toBe(!contextShown);
        expect(model.calendar.selected).toEqual(previous.calendar.selected);
        expect(model.calendar.reads).toBe(previous.calendar.reads);
        expect(model.upcoming).toBe(previous.upcoming);
        expect(preferenceSnapshot(model)).toEqual({
          ...preferenceSnapshot(previous),
          hideContextPanel: !contextShown,
        });
        expect(result.commands?.map((command) => command.name) ?? []).toEqual(
          previousContext === contextShown ? [] : ["SavePreferences"]
        );
      }
    })
);

it.effect.prop(
  "context visibility round-trips per person through the existing v2 writer without dropping other settings",
  { hidden: Schema.Boolean },
  ({ hidden }) =>
    Effect.gen(function* savedContext() {
      const base = keyboardFixture();
      const person = Option.getOrThrow(base.person);
      const other = "rank6-other-person";

      localStorage.removeItem(`calendar.visibility.${person}`);
      localStorage.removeItem(`calendar.visibility.${other}`);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          localStorage.removeItem(`calendar.visibility.${person}`);
          localStorage.removeItem(`calendar.visibility.${other}`);
        })
      );

      const model = {
        ...base,
        settings: { ...base.settings, hideContextPanel: hidden },
      };

      yield* SavePreferences({ ...preferenceSnapshot(model), person }).effect;

      const reloaded = update(
        base,
        yield* ReadPreferences({ person }).effect
      ).model;

      expect(preferenceSnapshot(reloaded)).toEqual(preferenceSnapshot(model));
      expect(preferenceSnapshot(reloaded).version).toBe(2);
      expect(
        normalizePreferences({ version: 2, visibility: {} }).hideContextPanel
      ).toBe(false);

      const otherRead = yield* ReadPreferences({ person: other }).effect;
      expect(otherRead).toEqual(
        Message.ReceivedPreferences({
          person: other,
          preferences: normalizePreferences({ version: 2, visibility: {} }),
        })
      );
      expect(update(model, otherRead).model).toBe(model);
      expect(
        Option.isNone(
          Schema.decodeUnknownOption(StoredPreferences)({
            hideContextPanel: "true",
            version: 2,
            visibility: {},
          })
        )
      ).toBe(true);
    }).pipe(Effect.scoped)
);

it.effect(
  "native panel keys resolve independently on Mac and Windows, including shifted Backslash reported as a pipe",
  () =>
    Effect.sync(() => {
      const model = keyboardFixture();

      for (const platform of ["MacIntel", "Win32"]) {
        for (const [key, mod, shift, id] of [
          ["\\", false, false, "context"],
          ["\\", true, false, "sidebar"],
          ["|", true, true, "sidebars"],
        ] as const) {
          const message = keyboardMessage(
            model,
            new KeyboardEvent("keydown", {
              cancelable: true,
              code: "Backslash",
              ctrlKey: mod && platform === "Win32",
              key,
              metaKey: mod && platform === "MacIntel",
              shiftKey: shift,
            }),
            model.calendar.now,
            platform
          );

          const next = update(model, Option.getOrThrow(message));
          const expected = update(model, Message.KeyboardAction({ id }));

          expect(next.model.keyboard.sidebar).toBe(
            expected.model.keyboard.sidebar
          );
          expect(next.model.settings.hideContextPanel).toBe(
            expected.model.settings.hideContextPanel
          );
          expect(next.commands?.map((command) => command.name) ?? []).toEqual(
            expected.commands?.map((command) => command.name) ?? []
          );
        }
      }
    })
);

it.effect(
  "the saved preference hides both kinds of context without clearing selection or the upcoming slice",
  () =>
    Effect.gen(function* hiddenContextViews() {
      for (const base of [
        keyboardFixture(),
        meetingModel([savedMeeting(1, 30, 60)]),
      ]) {
        const toggled = update(
          base,
          Message.KeyboardAction({ id: "context" })
        ).model;

        expect(toggled.calendar.selected).toEqual(base.calendar.selected);
        expect(toggled.upcoming).toBe(base.upcoming);

        const rendered = yield* renderToString(
          { init: () => ({ model: toggled }), view },
          { isHydratable: false }
        );

        const dom = new DOMParser().parseFromString(rendered.html, "text/html");

        expect(dom.querySelector(".detail-panel, .upcoming-panel")).toBeNull();
        expect(dom.querySelector(".sidebar")).not.toBeNull();
      }
    })
);

it.effect(
  "a read-only event double-click restores hidden details without starting an editor",
  () =>
    Effect.gen(function* readOnlyDetails() {
      const base = keyboardFixture();

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: base.calendar.calendars.map((calendar) => ({
            ...calendar,
            accessRole: "reader" as const,
          })),
        },
        settings: { ...base.settings, hideContextPanel: true },
      };

      const event = visibleEvents(model).find((item) => item.selected);
      expect(event).toBeDefined();

      const opened = update(
        model,
        Message.KeyboardAction({ id: "open-event" })
      );

      expect(opened.model.settings.hideContextPanel).toBe(false);
      expect(opened.model.calendar.selected).toEqual(model.calendar.selected);
      expect(opened.commands?.map((command) => command.name)).toEqual([
        "SavePreferences",
      ]);

      const rendered = yield* renderToString(
        { init: () => ({ model: opened.model }), view },
        { isHydratable: false }
      );

      const dom = new DOMParser().parseFromString(rendered.html, "text/html");

      expect(dom.querySelector(".detail-panel")?.textContent).toContain(
        "This calendar is read-only."
      );
      expect(dom.querySelector("#event-editor-dialog")).toBeNull();
    })
);
