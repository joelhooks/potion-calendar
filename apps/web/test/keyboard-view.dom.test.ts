import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, FileSystem, Option, Stream } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import {
  keyboardMessage,
  observeKeyboard,
} from "../src/client/keyboard/input.js";
import { keyboardRegistry, keyHints } from "../src/client/keyboard/registry.js";
import { keyboardStream } from "../src/client/keyboard/subscription.js";
import { view } from "../src/features/app.js";
import { maximumDisplayedDays, visibleDays } from "../src/layout/navigation.js";
import { dayLabel } from "../src/layout/presentation.js";
import { editorViewFields } from "./editor-fixture.js";
import { keyboardDensityFixture, keyboardFixture } from "./keyboard-fixture.js";

const render = (model: AppModel) =>
  renderToString({ init: () => ({ model }), view }, { isHydratable: false });

const documentFor = (html: string): Document =>
  new DOMParser().parseFromString(html, "text/html");

it.effect(
  "rendered menu and shortcuts hints come only from the binding registry",
  () =>
    Effect.gen(function* registrySurfaces() {
      const base = keyboardFixture();

      const menu = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const commands = documentFor((yield* render(menu)).html);

      const page = update(
        base,
        Message.KeyboardAction({ id: "shortcuts" })
      ).model;

      const shortcuts = documentFor((yield* render(page)).html);
      expect(
        commands.querySelector<HTMLInputElement>("#keyboard-query")?.placeholder
      ).toBe("Type a command…");
      expect(commands.querySelector("dialog")?.getAttribute("aria-modal")).toBe(
        "true"
      );
      expect(commands.body.textContent).toContain("Navigate");
      expect(commands.body.textContent).toContain("Select");
      expect(commands.body.textContent).toContain("Close");

      for (const action of keyboardRegistry) {
        const command = commands.querySelector(`[id="command-${action.id}"]`);

        if (action.menu !== false && action.availability(menu) !== "hidden") {
          expect(command?.textContent, action.id).toContain(action.title);
          expect(command?.textContent, action.id).toContain(
            keyHints(action).join(" / ")
          );
        } else {
          expect(command, action.id).toBeNull();
        }

        const shortcut = shortcuts.querySelector(
          `[data-shortcut-id="${action.id}"]`
        );

        if (action.keys.length > 0) {
          expect(shortcut?.querySelector("kbd")?.textContent, action.id).toBe(
            keyHints(action).join(" / ")
          );
        } else {
          expect(shortcut).toBeNull();
        }
      }

      expect(shortcuts.querySelector("#calendar-view")).not.toBeNull();
      expect(shortcuts.querySelector("#calendar-navigation")).not.toBeNull();
      expect(shortcuts.querySelector(".time-grid")).toBeNull();
      const date = update(base, Message.KeyboardAction({ id: "date" })).model;
      expect(commandChoices(date)).toHaveLength(0);
      expect(
        documentFor((yield* render(date)).html).querySelector<HTMLInputElement>(
          "#keyboard-query"
        )?.placeholder
      ).toBe("e.g. nov 5, in 10 weeks");
    })
);

it.effect(
  "native key events leave text editing and unhandled browser shortcuts alone",
  () =>
    Effect.sync(() => {
      const model = keyboardFixture();
      const input = document.createElement("textarea");
      document.body.append(input);

      for (const key of [
        "c",
        "t",
        "n",
        "e",
        "Delete",
        "ArrowLeft",
        "Enter",
        "z",
        "d",
      ]) {
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: key === "z" || key === "d",
          key,
        });

        input.addEventListener(
          "keydown",
          (received) => {
            expect(Option.isNone(keyboardMessage(model, received, 10))).toBe(
              true
            );
          },
          { once: true }
        );
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }

      const event = new KeyboardEvent("keydown", {
        cancelable: true,
        ctrlKey: true,
        key: "z",
      });

      expect(Option.isNone(keyboardMessage(model, event, 10))).toBe(true);
      expect(
        Option.isSome(
          keyboardMessage(
            model,
            new KeyboardEvent("keydown", { ctrlKey: true, key: "k" }),
            10
          )
        )
      ).toBe(true);
      expect(
        Option.isNone(
          keyboardMessage(
            model,
            new KeyboardEvent("keydown", { isComposing: true, key: "c" }),
            10
          )
        )
      ).toBe(true);
      input.remove();
    })
);

it.effect(
  "the real keyboard stream prevents only handled keys synchronously and releases its listener",
  () =>
    Effect.gen(function* subscribedKeyboard() {
      const model = keyboardFixture();
      const ready = yield* Deferred.make<boolean>();
      const addListener = window.addEventListener;

      const spy = vi
        .spyOn(window, "addEventListener")
        .mockImplementation((type, listener, options) => {
          addListener.call(window, type, listener, options);

          if (type === "keydown") {
            Deferred.doneUnsafe(ready, Effect.succeed(true));
          }
        });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          spy.mockRestore();
        })
      );

      const waiting = yield* Effect.forkChild(
        keyboardStream(() => model).pipe(Stream.runHead)
      );

      yield* Deferred.await(ready);

      const event = new KeyboardEvent("keydown", {
        cancelable: true,
        ctrlKey: true,
        key: "k",
      });

      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      const message = yield* Fiber.join(waiting);
      expect(Option.isSome(message)).toBe(true);

      const after = new KeyboardEvent("keydown", {
        cancelable: true,
        ctrlKey: true,
        key: "k",
      });

      window.dispatchEvent(after);
      expect(after.defaultPrevented).toBe(false);

      const none = new KeyboardEvent("keydown", {
        cancelable: true,
        ctrlKey: true,
        key: "d",
      });

      const unselected = {
        ...model,
        calendar: { ...model.calendar, selected: [] },
      };

      expect(Option.isNone(observeKeyboard(unselected, none, 10))).toBe(true);
      expect(none.defaultPrevented).toBe(false);

      const prefixed = {
        ...unselected,
        keyboard: { ...unselected.keyboard, prefix: "e" },
      };

      const unhandled = new KeyboardEvent("keydown", {
        cancelable: true,
        key: "F6",
      });

      expect(observeKeyboard(prefixed, unhandled, 10)).toEqual(
        Option.some(Message.KeyboardResetSequence())
      );
      expect(unhandled.defaultPrevented).toBe(false);
    }).pipe(Effect.scoped)
);

it.effect(
  "platform Mod and Option-T use physical keys without stealing literal Control on macOS",
  () =>
    Effect.sync(() => {
      const model = keyboardFixture();
      const cmd = new KeyboardEvent("keydown", { key: "k", metaKey: true });
      const ctrl = new KeyboardEvent("keydown", { ctrlKey: true, key: "k" });
      expect(Option.isSome(keyboardMessage(model, cmd, 1, "MacIntel"))).toBe(
        true
      );
      expect(Option.isNone(keyboardMessage(model, ctrl, 1, "MacIntel"))).toBe(
        true
      );
      expect(Option.isSome(keyboardMessage(model, ctrl, 1, "Win32"))).toBe(
        true
      );
      expect(Option.isNone(keyboardMessage(model, cmd, 1, "Win32"))).toBe(true);

      const alt = new KeyboardEvent("keydown", {
        altKey: true,
        code: "KeyT",
        key: "†",
      });

      expect(keyboardMessage(model, alt, 1, "MacIntel")).toEqual(
        Option.some(
          Message.PressedCalendarKey({
            alt: true,
            key: "t",
            mod: false,
            now: 1,
            shift: false,
          })
        )
      );
    })
);

it.effect(
  "field sequences reuse the editor's initial focus, including calendar gate fallback",
  () =>
    Effect.gen(function* focusedEditor() {
      const base = keyboardFixture();

      for (const [key, id] of [
        ["t", "title"],
        ["d", "startDate"],
        ["s", "startTime"],
        ["q", "endTime"],
        ["p", "participantEmail"],
        ["l", "location"],
        ["w", "description"],
        ["r", "repeat"],
        ["h", "reminderInput"],
        ["a", "allDay"],
        ["c", "calendar"],
      ]) {
        const prefix = update(
          base,
          Message.PressedCalendarKey({
            alt: false,
            key: "e",
            mod: false,
            now: 10,
            shift: false,
          })
        ).model;

        const opened = update(
          prefix,
          Message.PressedCalendarKey({
            alt: false,
            key: key ?? "",
            mod: false,
            now: 11,
            shift: false,
          })
        );

        expect(opened.commands?.map((command) => command.name)).toEqual([
          "DispatchEditing",
        ]);

        const model = {
          ...opened.model,
          editing: {
            ...opened.model.editing,
            view: EditorView.cases.Editing.make(editorViewFields),
          },
        };

        const dom = documentFor((yield* render(model)).html);
        let focus = `event-${id}`;

        if (id === "calendar") {
          focus = "event-color";
        }

        if (
          id === "reminderInput" &&
          editorViewFields.draft.reminders.useDefault
        ) {
          focus = "event-defaultReminders";
        }

        expect(
          dom.querySelector<HTMLElement>("#event-editor-dialog")?.dataset
            .initialFocus
        ).toBe(focus);
        expect(dom.querySelector(`#${focus}`), focus).not.toBeNull();
        expect(
          dom.querySelector(`#${focus}`)?.matches(":disabled"),
          focus
        ).toBe(false);
      }

      for (const useDefault of [true, false]) {
        const model = {
          ...base,
          editing: {
            ...base.editing,
            view: EditorView.cases.Editing.make({
              ...editorViewFields,
              draft: {
                ...editorViewFields.draft,
                reminders: { ...editorViewFields.draft.reminders, useDefault },
              },
            }),
          },
          keyboard: { ...base.keyboard, focus: "event-reminderInput" },
        };

        const dom = documentFor((yield* render(model)).html);

        const focus = dom.querySelector<HTMLElement>("#event-editor-dialog")
          ?.dataset.initialFocus;

        expect(focus).toBe(
          useDefault ? "event-defaultReminders" : "event-reminderInput"
        );
        expect(dom.querySelector(`#${focus}`)?.matches(":disabled")).toBe(
          false
        );
      }

      for (const moveSupport of ["available", "notAvailable"] as const) {
        const model = {
          ...base,
          editing: {
            ...base.editing,
            view: EditorView.cases.Editing.make({
              ...editorViewFields,
              moveSupport,
            }),
          },
          keyboard: { ...base.keyboard, focus: "event-calendar" },
        };

        expect(
          documentFor((yield* render(model)).html).querySelector<HTMLElement>(
            "#event-editor-dialog"
          )?.dataset.initialFocus
        ).toBe(moveSupport === "available" ? "event-calendar" : "event-color");
      }
    })
);

it.effect(
  "10–31 displayed-day views keep positive equal columns and today visible",
  () =>
    Effect.gen(function* wideDayViews() {
      const base = keyboardFixture();

      for (const { count, form } of [
        { count: 10, form: "full" },
        { count: 20, form: "initial" },
        { count: maximumDisplayedDays, form: "number" },
      ] as const) {
        const { model } = update(
          base,
          Message.ClickedView({ days: count, mode: "days" })
        );

        const dom = documentFor((yield* render(model)).html);
        const columns = [...dom.querySelectorAll<HTMLElement>(".day-column")];
        expect(visibleDays(model.calendar.navigation)).toHaveLength(count);
        expect(columns).toHaveLength(count);

        const headers = [...dom.querySelectorAll<HTMLElement>(".day-header")];

        expect(headers).toHaveLength(count);

        for (const header of headers) {
          const day = Number(header.dataset.day);
          const number = dayLabel(day, { day: "numeric" });

          const labels = {
            full: dayLabel(day, { day: "numeric", weekday: "short" }),
            initial: `${number} ${dayLabel(day, { weekday: "narrow" })}`,
            number,
          };

          expect(header.dataset.dayHeaderForm).toBe(form);
          expect(header.querySelector(".day-header-label")?.textContent).toBe(
            labels[form]
          );
          expect(header.getAttribute("aria-label")).toBe(
            dayLabel(day, { dateStyle: "full" })
          );
        }

        const options = [
          ...dom.querySelectorAll<HTMLOptionElement>("option"),
        ].map((option) => option.value);

        for (let day = 1; day <= maximumDisplayedDays; day += 1) {
          expect(options).toContain(String(day));
        }

        const template =
          dom.querySelector<HTMLElement>(".day-columns")?.style
            .gridTemplateColumns ?? "";

        expect(template).toContain(`repeat(${count},`);

        const width = Number(
          /(?<width>-?\d+(?:\.\d+)?)px/u.exec(template)?.groups?.width
        );

        expect(width).toBeGreaterThan(0);
        expect(dom.querySelectorAll(".now-today")).toHaveLength(1);
      }
    })
);

it.effect(
  "exports actual Foldkit keyboard surfaces with synthetic events for desk captures",
  () =>
    Effect.gen(function* exportKeyboardFixtures() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const platform = vi
        .spyOn(navigator, "platform", "get")
        .mockReturnValue("MacIntel");

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          platform.mockRestore();
        })
      );
      const base = keyboardFixture();

      const commands = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const filtered = update(
        commands,
        Message.KeyboardQuery({ query: "day" })
      ).model;

      const date = update(
        update(base, Message.KeyboardAction({ id: "date" })).model,
        Message.KeyboardQuery({ query: "nov 5" })
      ).model;

      const shortcuts = update(
        base,
        Message.KeyboardAction({ id: "shortcuts" })
      ).model;

      for (const [name, model] of [
        ["commands", commands],
        ["commands-filtered", filtered],
        ["go-to-date", date],
        ["shortcuts", shortcuts],
        ["31-days", keyboardDensityFixture()],
      ] as const) {
        const rendered = yield* render(model);
        const doc = documentFor(rendered.html);

        const total = Number(
          (
            doc.querySelector<HTMLElement>(".day-headers")?.style.width ?? "NaN"
          ).replace("px", "")
        );

        const layoutCheck =
          name === "31-days"
            ? `if(innerWidth!==1440)throw Error('Fixture requires a 1440 CSS px viewport');if(document.documentElement.scrollWidth!==innerWidth)throw Error('31-day grid widened the page');document.documentElement.dataset.pageOverflow='pass';`
            : "";

        if (name === "31-days") {
          expect(doc.querySelectorAll(".event-chip").length).toBeGreaterThan(0);
          expect(doc.body.textContent).not.toContain("Loading events");
          expect(total).toBeGreaterThanOrEqual(model.calendar.viewportWidth);
          expect(total - model.calendar.viewportWidth).toBeLessThan(
            maximumDisplayedDays
          );
        }

        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="1440x900"><meta name="fixture-grid-width" content="${model.calendar.viewportWidth}"><meta name="fixture-keyboard-platform" content="MacIntel"><title>Keyboard fixture</title><style>${css}</style></head><body>${rendered.html}<script>document.querySelector('dialog')?.showModal();document.querySelector('#keyboard-query, #shortcuts-query')?.focus();requestAnimationFrame(()=>{${layoutCheck}});</script></body></html>`;
        yield* fs.writeFileString(
          `../../.git/keyboard-${name}-fixture.html`,
          html
        );
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
