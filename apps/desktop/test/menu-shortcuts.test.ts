import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { MenuItemConstructorOptions } from "electron";

import { applicationMenu } from "../src/menus.js";
import { NativeIntent } from "../src/native-host.js";
import type { NativeIntentValue } from "../src/native-host.js";

it.effect.each([
  {
    accelerator: "CmdOrCtrl+1",
    expected: NativeIntent.cases.OpenWindow.make({}),
    label: "Show Calendar Window",
  },
  {
    accelerator: "CmdOrCtrl+,",
    expected: NativeIntent.cases.OpenSettings.make({ page: "general" }),
    label: "Settings…",
  },
])("the native app menu sends the existing intent for $accelerator", (entry) =>
  Effect.sync(() => {
    const intents: NativeIntentValue[] = [];
    let signIns = 0;

    const template = applicationMenu(
      () => {
        signIns += 1;
      },
      (intent) => {
        intents.push(intent);
      }
    );

    const app = template.find((row) => row.label === "Potion Calendar");
    const rows = app?.submenu ?? [];
    const item = rows.find((row) => row.label === entry.label);

    expect(item).toBeDefined();
    expect(item?.accelerator).toBe(entry.accelerator);
    expect(item?.role).toBeUndefined();
    expect(item?.click).toBeTypeOf("function");

    item?.click?.();
    expect(intents).toEqual([entry.expected]);
    expect(signIns).toBe(0);
  })
);

it.effect(
  "all existing native roles retain Electron-owned defaults, including reload",
  () =>
    Effect.sync(() => {
      const template = applicationMenu(
        () => {},
        () => {}
      );

      const roles = template
        .flatMap<MenuItemConstructorOptions>((row) => [
          row,
          ...(row.submenu ?? []),
        ])
        .filter((row) => row.role !== undefined);

      expect(roles.map((row) => row.role)).toEqual([
        "about",
        "services",
        "hide",
        "hideOthers",
        "unhide",
        "quit",
        "undo",
        "redo",
        "cut",
        "copy",
        "paste",
        "pasteAndMatchStyle",
        "delete",
        "selectAll",
        "reload",
        "forceReload",
        "resetZoom",
        "zoomIn",
        "zoomOut",
        "togglefullscreen",
        "windowMenu",
      ]);
      expect(
        roles.every(
          (row) => row.accelerator === undefined && row.click === undefined
        )
      ).toBe(true);
    })
);
