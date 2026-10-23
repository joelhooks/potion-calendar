import { Option } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../app.js";
import { globalShortcutBinding } from "./hints.js";
import { keyboardRegistry } from "./registry.js";
import type { KeyboardAction, ShortcutSection } from "./registry.js";

export type ShortcutReference = Pick<
  KeyboardAction,
  "id" | "title" | "keys" | "keywords"
> & { readonly section: ShortcutSection | "System-wide" };

const globalRows = [
  {
    field: "menuShortcut",
    id: "global-menu-bar",
    title: "Show/hide menu bar calendar",
  },
  {
    field: "joinShortcut",
    id: "global-join-conferencing",
    title: "Join conferencing globally",
  },
] satisfies readonly {
  readonly field: "menuShortcut" | "joinShortcut";
  readonly id: string;
  readonly title: string;
}[];

export const shortcutReference = (
  model: AppModel
): readonly ShortcutReference[] => {
  const settings =
    model.desktop.availability === "available"
      ? AsyncData.getData(model.desktop.settings)
      : Option.none();

  const globals = Option.match(settings, {
    onNone: (): readonly ShortcutReference[] => [],
    onSome: ({ preferences }) =>
      globalRows.flatMap((row): readonly ShortcutReference[] => {
        const accelerator = preferences[row.field];

        return accelerator === null
          ? []
          : [
              {
                id: row.id,
                keys: [globalShortcutBinding(accelerator)],
                keywords: [{ text: "desktop", weight: 1 }],
                section: "System-wide",
                title: row.title,
              },
            ];
      }),
  });

  return [...globals, ...keyboardRegistry];
};
