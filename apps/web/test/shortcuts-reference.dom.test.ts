import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { DesktopNotice, RemoteDesktop } from "../src/client/desktop/model.js";
import { view } from "../src/features/app.js";
import { toolbar } from "../src/features/calendar.js";
import { commandMenu } from "../src/features/command-menu.js";
import {
  readOnlyCommandsFixture,
  shortcutsReferenceFixture,
} from "./shortcuts-reference-fixture.js";

const creationView = (current: AppModel, h: HtmlBuilder<AppMessage>) => ({
  body: h.div([], [toolbar(current, h), ...commandMenu(current, h)]),
  title: "Create availability",
});

it.effect.prop(
  "actual shortcuts reference mirrors configured native bindings before General without browser defaults",
  {
    joinSet: Schema.Boolean,
    menuSet: Schema.Boolean,
    native: Schema.Boolean,
    platform: Schema.Literals(["MacIntel", "Win32"]),
  },
  ({ joinSet, menuSet, native, platform }) =>
    Effect.gen(function* configuredReference() {
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
        ),
        (spy) =>
          Effect.sync(() => {
            spy.mockRestore();
          })
      );
      const mac = platform === "MacIntel";
      const joinBinding = mac ? "control+command+q" : "ctrl+alt+q";
      const menuBinding = mac ? "Control+Command+X" : "Control+Alt+X";

      const base = shortcutsReferenceFixture(
        {
          joinShortcut: joinSet ? joinBinding : null,
          menuShortcut: menuSet ? menuBinding : null,
        },
        "light",
        native
      );

      const rendered = yield* renderToString(
        { init: () => ({ model: base }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");

      const rows = [
        ...root.querySelectorAll<HTMLElement>(
          "#system-wide [data-shortcut-id]"
        ),
      ];

      const expected = native
        ? [
            ...(menuSet
              ? [{ id: "global-menu-bar", key: mac ? "⌃⌘X" : "Ctrl+Alt+X" }]
              : []),
            ...(joinSet
              ? [
                  {
                    id: "global-join-conferencing",
                    key: mac ? "⌃⌘Q" : "Ctrl+Alt+Q",
                  },
                ]
              : []),
          ]
        : [];

      expect(
        rows.map((row) => ({
          id: row.dataset.shortcutId,
          key: row.querySelector("kbd")?.textContent,
        })),
        "System-wide reflects only configured native shortcuts"
      ).toEqual(expected);
      expect(root.querySelector("#system-wide") !== null).toBe(
        expected.length > 0
      );

      const sections = [
        ...root.querySelectorAll("#shortcuts-page > section"),
      ].map((section) => section.id);

      expect(sections[0]).toBe(expected.length > 0 ? "system-wide" : "general");
      expect(
        root.querySelectorAll(
          "#command-global-menu-bar, #command-global-join-conferencing"
        )
      ).toHaveLength(0);
    }).pipe(Effect.scoped)
);

it.effect.each(["unknown", "unavailable", "available"] as const)(
  "shortcuts reference invents no global defaults while settings have no data (%s)",
  (availability) =>
    Effect.gen(function* absentSettings() {
      const base = shortcutsReferenceFixture(
        { joinShortcut: null, menuShortcut: null },
        "light",
        false
      );

      const model = {
        ...base,
        desktop: {
          ...base.desktop,
          availability,
          settings: RemoteDesktop.Loading(),
        },
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(root.querySelector("#system-wide")).toBeNull();
    })
);

it.effect(
  "new bridge settings and existing shortcut search update the rendered global rows without saving preferences",
  () =>
    Effect.gen(function* settingsAndSearch() {
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32")
        ),
        (spy) =>
          Effect.sync(() => {
            spy.mockRestore();
          })
      );

      const base = shortcutsReferenceFixture({
        joinShortcut: "Control+Alt+Q",
        menuShortcut: "Control+Alt+X",
      });

      const settings = Option.getOrThrow(
        AsyncData.getData(base.desktop.settings)
      );

      const original = update(
        base,
        Message.KeyboardQuery({ query: "  ctrl+alt+q  " })
      );

      const rendered = yield* renderToString(
        { init: () => ({ model: original.model }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        root.querySelectorAll("#system-wide [data-shortcut-id]")
      ).toHaveLength(1);
      expect(
        root.querySelector('[data-shortcut-id="global-join-conferencing"]')
      ).not.toBeNull();
      expect(
        root.querySelector('[data-shortcut-id="global-menu-bar"]')
      ).toBeNull();
      expect(
        original.commands?.some(
          (command) =>
            command.name === "SavePreferences" ||
            command.name === "ApplyDesktopRequest"
        ) ?? false
      ).toBe(false);

      for (const query of ["conferencing", "desktop"]) {
        const searched = update(base, Message.KeyboardQuery({ query })).model;

        const result = yield* renderToString(
          { init: () => ({ model: searched }), view },
          { isHydratable: false }
        );

        const searchedRoot = new DOMParser().parseFromString(
          result.html,
          "text/html"
        );

        expect(
          searchedRoot.querySelectorAll("#system-wide [data-shortcut-id]")
        ).toHaveLength(query === "desktop" ? 2 : 1);
      }

      const next = update(
        base,
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Settings.make({
            settings: {
              ...settings,
              preferences: { ...settings.preferences, joinShortcut: null },
              revision: settings.revision + 1,
            },
          }),
        })
      );

      const updated = yield* renderToString(
        { init: () => ({ model: next.model }), view },
        { isHydratable: false }
      );

      const updatedRoot = new DOMParser().parseFromString(
        updated.html,
        "text/html"
      );

      expect(
        updatedRoot.querySelector(
          '[data-shortcut-id="global-join-conferencing"]'
        )
      ).toBeNull();
      expect(
        updatedRoot.querySelector('[data-shortcut-id="global-menu-bar"] kbd')
          ?.textContent
      ).toBe("Ctrl+Alt+X");
      expect(
        next.commands?.some(
          (command) =>
            command.name === "ApplyDesktopRequest" ||
            command.name === "SavePreferences"
        ) ?? false
      ).toBe(false);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "Create presentations follow any writable calendar without changing keyboard refusal",
  {
    roles: Schema.Array(
      Schema.Literals(["owner", "writer", "reader", "freeBusyReader"])
    ),
  },
  ({ roles }) =>
    Effect.gen(function* creationAvailability() {
      const base = readOnlyCommandsFixture();

      const template = Option.getOrThrow(
        Option.fromUndefinedOr(base.calendar.calendars[0])
      );

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: roles.map((accessRole, index) => ({
            ...template,
            accessRole,
            calendarId: `role-${index}`,
          })),
        },
      };

      const writable = roles.includes("owner") || roles.includes("writer");

      const rendered = yield* renderToString(
        { init: () => ({ model }), view: creationView },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        root.querySelector("#command-create") !== null,
        "Create command follows writable destination availability"
      ).toBe(writable);
      expect(
        root.querySelector<HTMLButtonElement>(
          '.toolbar button[title="Create event (C)"]'
        )?.disabled
      ).toBe(!writable);

      if (!writable) {
        const attempted = update(
          model,
          Message.KeyboardAction({ id: "create" })
        );

        expect(
          attempted.commands?.some(
            (command) => command.name === "DispatchEditing"
          ) ?? false
        ).toBe(false);
      }
    })
);

it.effect.each([false, true])(
  "read-only command menu hides Create while preserving the named disabled toolbar (phone=%s)",
  (phone) =>
    Effect.gen(function* readOnlyCreation() {
      const base = readOnlyCommandsFixture();

      const measured = phone
        ? update(base, Message.MeasuredShellViewport({ width: 390 })).model
        : base;

      const rendered = yield* renderToString(
        { init: () => ({ model: measured }), view },
        { isHydratable: false }
      );

      const root = new DOMParser().parseFromString(rendered.html, "text/html");
      expect(
        root.querySelector("#command-create"),
        "Read-only command menu must hide Create"
      ).toBeNull();

      const create = root.querySelector<HTMLButtonElement>(
        '.toolbar button[title="Create event (C)"]'
      );

      if (!phone) {
        expect(
          create?.disabled,
          "Read-only toolbar Create must stay disabled"
        ).toBe(true);
        expect(create?.textContent?.trim()).toBe("Create");
        expect(create?.getAttribute("aria-hidden")).not.toBe("true");
      }

      for (const button of root.querySelectorAll<HTMLButtonElement>(
        '.phone-toolbar button[title="Create event (C)"]'
      )) {
        expect(button.disabled).toBe(true);
        expect(button.textContent?.trim()).toBe("Create");
      }

      const dispatched = update(
        measured,
        Message.KeyboardAction({ id: "create" })
      );

      expect(
        dispatched.commands?.some(
          (command) => command.name === "DispatchEditing"
        ) ?? false
      ).toBe(false);
    })
);
