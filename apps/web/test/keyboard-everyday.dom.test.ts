import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { editorConferencingContext } from "../src/client/conferencing/editor-context.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { FocusShortcutSearch } from "../src/client/keyboard/browser.js";
import { observeKeyboard } from "../src/client/keyboard/input.js";
import { homeZone } from "../src/client/time-zones/model.js";
import { view } from "../src/features/app.js";
import { chip as eventChip, detailPanel } from "../src/features/calendar.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { CalendarRoute, ShortcutsRoute } from "../src/layout/route.js";
import { primarySelection } from "../src/layout/selection-set.js";
import { keyboardFixture } from "./keyboard-fixture.js";

it.effect(
  "native Mod-F focuses Shortcuts search without changing its query or opening event Search",
  () =>
    Effect.gen(function* localShortcutSearch() {
      const platform = vi.spyOn(navigator, "platform", "get");

      const host = document.createElement("div");
      document.body.append(host);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          platform.mockRestore();
          host.remove();
        })
      );

      for (const system of ["MacIntel", "Win32"]) {
        platform.mockReturnValue(system);

        const base = keyboardFixture();

        const model = {
          ...base,
          keyboard: { ...base.keyboard, query: "calendar" },
          route: ShortcutsRoute.make({ section: Option.none() }),
        };

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        host.innerHTML = rendered.html;

        const query = host.querySelector<HTMLInputElement>("#shortcuts-query");

        if (query === null) {
          return yield* Effect.die(new Error("Missing shortcut search"));
        }

        for (const target of [query, host]) {
          const received: AppMessage[] = [];

          const listener = (event: KeyboardEvent) => {
            const message = observeKeyboard(model, event, model.calendar.now);

            if (Option.isSome(message)) {
              received.push(message.value);
            }
          };

          target.addEventListener("keydown", listener, { once: true });

          const event = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: system === "Win32",
            key: "f",
            metaKey: system === "MacIntel",
          });

          target.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
          expect(received).toHaveLength(1);

          const result = update(
            model,
            Option.getOrThrow(Option.fromUndefinedOr(received[0]))
          );

          expect(result.commands).toHaveLength(1);
          expect(result.commands?.[0]?.name).toBe("FocusShortcutSearch");
          expect(result.model.route).toBe(model.route);
          expect(result.model.search).toBe(model.search);
          expect(result.model.calendar).toBe(model.calendar);
          expect(result.model.keyboard.query).toBe("calendar");
          expect(result.model.keyboard.screen).toBe("closed");
          yield* FocusShortcutSearch().effect;
          expect(document.activeElement).toBe(query);
          expect(query.value).toBe("calendar");
        }
      }

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect("native Mod-F outside Shortcuts still opens event Search", () =>
  Effect.sync(() => {
    const base = keyboardFixture();

    const model = { ...base, route: CalendarRoute.make({}) };

    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      ctrlKey: true,
      key: "f",
    });

    const message = observeKeyboard(model, event, model.calendar.now);
    expect(Option.isSome(message)).toBe(true);

    const result = update(model, Option.getOrThrow(message));
    expect(result.model.route._tag).toBe("Search");
    expect(
      result.commands?.some((command) => command.name === "FocusShortcutSearch")
    ).toBe(false);
  })
);

const chipView = (model: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.main(
    [],
    [
      ...visibleEvents(model).map((event) => eventChip(h, event, {})),
      ...detailPanel(model, h),
    ]
  ),
  title: "Event chip actions",
});

it.effect(
  "a writable event's first click selects without commands and its double-click opens the existing editor",
  () =>
    Effect.sync(() => {
      const base = keyboardFixture();

      const model = {
        ...base,
        calendar: { ...base.calendar, selected: [] },
      };

      const event = visibleEvents(model).find((item) => !item.allDay);

      if (event === undefined) {
        throw new Error("Missing timed event chip");
      }

      const chip = Scene.selector(`[data-event-key='${event.key}']`);

      Scene.scene(
        { update, view: chipView },
        Scene.given(model),
        Scene.click(chip),
        Scene.Command.expectNone(),
        Scene.expect(
          Scene.role("complementary", { name: "Event details" })
        ).toContainText(event.title),
        Scene.doubleClick(chip),
        Scene.Command.expectHas(DispatchEditing),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing())
      );

      const selected = update(
        model,
        Message.ClickedEvent({ key: event.key })
      ).model;

      const opened = update(
        selected,
        Message.KeyboardAction({ id: "open-event" })
      );

      const expected = DispatchEditing({
        command: EditingCommand.cases.Open.make({
          request: EditorRequest.cases.Existing.make({
            calendars: selected.calendar.calendars,
            conferencingContext: editorConferencingContext(selected),
            event: event.source,
            intent: "ordinary",
            mode: "edit",
            navigation: selected.calendar.navigation,
            primaryZone: homeZone(selected),
            selection: primarySelection(selected.calendar.selected),
          }),
        }),
        personId: Option.getOrThrow(selected.person),
      });

      expect(opened.model.keyboard.focus).toBe("event-title");
      expect(opened.commands?.[0]?.args).toEqual(expected.args);
    })
);

it.effect(
  "double-clicking a read-only calendar event keeps details and guard copy without opening an editor",
  () =>
    Effect.sync(() => {
      const base = keyboardFixture();

      const model: AppModel = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: base.calendar.calendars.map((calendar) => ({
            ...calendar,
            accessRole: "reader",
          })),
          selected: [],
        },
      };

      const event = visibleEvents(model).find((item) => !item.allDay);

      if (event === undefined) {
        throw new Error("Missing read-only event chip");
      }

      const chip = Scene.selector(`[data-event-key='${event.key}']`);

      Scene.scene(
        { update, view: chipView },
        Scene.given(model),
        Scene.click(chip),
        Scene.Command.expectNone(),
        Scene.doubleClick(chip),
        Scene.Command.expectNone(),
        Scene.expect(
          Scene.role("complementary", { name: "Event details" })
        ).toContainText("This calendar is read-only."),
        Scene.expect(Scene.role("button", { name: /^Edit$/u })).toBeDisabled(),
        Scene.expect(Scene.selector("#event-editor-dialog")).toBeAbsent()
      );
    })
);

it.effect.prop(
  "chip opening follows calendar write roles and never opens an editor without selection",
  {
    role: Schema.Literals(["owner", "writer", "reader", "freeBusyReader"]),
    selected: Schema.Boolean,
  },
  ({ role, selected }) =>
    Effect.sync(() => {
      const base = keyboardFixture();

      const model: AppModel = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: base.calendar.calendars.map((calendar) => ({
            ...calendar,
            accessRole: role,
          })),
          selected: selected ? base.calendar.selected : [],
        },
      };

      const result = update(
        model,
        Message.KeyboardAction({ id: "open-event" })
      );

      expect(result.commands?.map((command) => command.name) ?? []).toEqual(
        selected && (role === "owner" || role === "writer")
          ? ["DispatchEditing"]
          : []
      );
      expect(result.model.calendar.selected).toEqual(model.calendar.selected);
      expect(result.model.calendar.reads).toBe(model.calendar.reads);
      expect(result.model.upcoming).toBe(model.upcoming);
    })
);

it.effect(
  "native Mod-Backslash toggles only the calendar sidebar on Mac and Windows",
  () =>
    Effect.gen(function* calendarSidebarKeys() {
      const platform = vi.spyOn(navigator, "platform", "get");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          platform.mockRestore();
        })
      );

      for (const system of ["MacIntel", "Win32"]) {
        platform.mockReturnValue(system);

        for (const sidebar of [true, false]) {
          const base = keyboardFixture();

          const model = { ...base, keyboard: { ...base.keyboard, sidebar } };

          const event = new KeyboardEvent("keydown", {
            cancelable: true,
            code: "Backslash",
            ctrlKey: system === "Win32",
            key: "\\",
            metaKey: system === "MacIntel",
          });

          const message = observeKeyboard(model, event, model.calendar.now);

          expect(event.defaultPrevented).toBe(true);

          const result = update(model, Option.getOrThrow(message));

          expect(result.model.keyboard.sidebar).toBe(!sidebar);
          expect(result.model.settings).toBe(model.settings);
          expect(result.model.calendar).toBe(model.calendar);
          expect(result.model.upcoming).toBe(model.upcoming);
          expect(result.commands ?? []).toHaveLength(0);

          const rendered = yield* renderToString(
            { init: () => ({ model: result.model }), view },
            { isHydratable: false }
          );

          const dom = new DOMParser().parseFromString(
            rendered.html,
            "text/html"
          );

          expect(dom.querySelector(".sidebar") !== null).toBe(!sidebar);
          expect(dom.querySelector("#command-menu-button") !== null).toBe(
            !sidebar
          );
          expect(dom.querySelector(".detail-panel")).not.toBeNull();

          const menuKey = observeKeyboard(
            result.model,
            new KeyboardEvent("keydown", {
              ctrlKey: system === "Win32",
              key: "k",
              metaKey: system === "MacIntel",
            }),
            model.calendar.now
          );

          const menu = update(result.model, Option.getOrThrow(menuKey)).model;

          const menuHtml = yield* renderToString(
            { init: () => ({ model: menu }), view },
            { isHydratable: false }
          );

          expect(
            new DOMParser()
              .parseFromString(menuHtml.html, "text/html")
              .querySelector("#keyboard-command-dialog")
          ).not.toBeNull();
        }
      }
    }).pipe(Effect.scoped)
);

it.effect("panel shortcuts leave text editing alone", () =>
  Effect.sync(() => {
    const model = keyboardFixture();

    const input = document.createElement("textarea");
    document.body.append(input);

    for (const flags of [
      {},
      { ctrlKey: true },
      { ctrlKey: true, shiftKey: true },
    ]) {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Backslash",
        key: "shiftKey" in flags ? "|" : "\\",
        ...flags,
      });

      input.addEventListener(
        "keydown",
        (received) => {
          expect(
            Option.isNone(observeKeyboard(model, received, model.calendar.now))
          ).toBe(true);
        },
        { once: true }
      );
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    input.remove();
  })
);

it.effect(
  "Shortcuts leaves composing, repeated and already-handled Mod-F alone",
  () =>
    Effect.sync(() => {
      const base = keyboardFixture();

      const model = {
        ...base,
        route: ShortcutsRoute.make({ section: Option.none() }),
      };

      for (const flags of [{ isComposing: true }, { repeat: true }, {}]) {
        const event = new KeyboardEvent("keydown", {
          cancelable: true,
          ctrlKey: true,
          key: "f",
          ...flags,
        });

        if (!("isComposing" in flags) && !("repeat" in flags)) {
          event.preventDefault();
        }

        expect(
          Option.isNone(observeKeyboard(model, event, model.calendar.now))
        ).toBe(true);
      }
    })
);
