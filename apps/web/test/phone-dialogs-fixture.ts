import { Option } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { SettingsRoute } from "../src/layout/route.js";
import { editorViewFields } from "./editor-fixture.js";
import { phoneShellFixture } from "./phone-shell-fixture.js";
import { loadedSearch } from "./search-more-fixture.js";

export const phoneDialogSurfaces = [
  "command",
  "editor",
  "settings",
  "search",
] as const;

export type PhoneDialogSurface = (typeof phoneDialogSurfaces)[number];

export const phoneDialogSelector = (surface: PhoneDialogSurface): string =>
  new Map([
    ["command", "#keyboard-command-dialog"],
    ["editor", "dialog[data-editing-dialog]"],
    ["settings", "#phone-settings-dialog"],
    ["search", "#phone-search-dialog"],
  ]).get(surface) ?? "dialog";

export const phoneDialogsFixture = (
  surface: PhoneDialogSurface,
  width: number,
  height: number,
  theme: "light" | "dark" = "light"
): AppModel => {
  const base = phoneShellFixture(width, height, "closed", theme);

  if (surface === "command") {
    return update(base, Message.KeyboardAction({ id: "commands" })).model;
  }

  if (surface === "editor") {
    return {
      ...base,
      editing: {
        ...base.editing,
        view: EditorView.cases.Editing.make({
          ...editorViewFields,
          draft: {
            ...editorViewFields.draft,
            title:
              "Planning the next small calendar release with design and engineering across connected accounts",
          },
        }),
      },
    };
  }

  if (surface === "settings") {
    return { ...base, route: SettingsRoute.make({ page: "general" }) };
  }

  const search = loadedSearch();
  const response = Option.getOrThrow(search.search.response);
  const [first] = response.results;

  if (first === undefined) {
    throw new Error("Missing phone search fixture result");
  }

  return {
    ...search,
    calendar: {
      ...search.calendar,
      viewport: base.calendar.viewport,
      viewportWidth: base.calendar.viewportWidth,
    },
    phoneShell: base.phoneShell,
    search: {
      ...search.search,
      response: Option.some({
        ...response,
        results: Array.from({ length: 20 }, (_, index) => ({
          ...first,
          event: {
            ...first.event,
            eventId: `phone-search-${index}`,
            iCalUID: `phone-search-${index}@example.test`,
            title: `Planning item ${index + 1} for the next calendar release`,
          },
        })),
      }),
    },
    settings: { ...search.settings, theme },
  };
};
