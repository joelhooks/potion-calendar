import { Option } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { actionCatalog } from "../src/client/keyboard/registry.js";
import { normalizePreferences } from "../src/client/settings/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import type { AppLanguage } from "../src/layout/app-locale.js";
import { SettingsRoute } from "../src/layout/route.js";
import { editorViewFields } from "./editor-fixture.js";
import { fixtureSelection } from "./fixture.js";

export const languageFixture = (
  language: typeof AppLanguage.Type,
  browser = "en-US",
  scene: "week" | "general" | "editor" | "date" = "week",
  width = 1440
): AppModel => {
  let model = fixtureSelection();
  ({ model } = update(
    model,
    Message.ReceivedSystemSettings({
      dark: false,
      hour24: false,
      locale: browser,
    })
  ));
  ({ model } = update(
    model,
    Message.ReceivedPreferences({
      person: Option.getOrThrow(model.person),
      preferences: normalizePreferences({
        ...preferenceSnapshot(model),
        language,
      }),
    })
  ));
  model = {
    ...model,
    calendar: { ...model.calendar, viewportWidth: width - 245 },
  };

  if (scene === "general") {
    return { ...model, route: SettingsRoute.make({ page: "general" }) };
  }

  if (scene === "editor") {
    return {
      ...model,
      editing: {
        ...model.editing,
        view: EditorView.cases.Editing.make(editorViewFields),
      },
    };
  }

  if (scene === "date") {
    const action = actionCatalog(model).find(
      (candidate) => candidate.id === "go-date"
    );

    if (action === undefined) {
      throw new Error("The actual Go to date action is missing");
    }

    ({ model } = update(model, action.dispatch(model)));
    ({ model } = update(model, Message.KeyboardQuery({ query: "2026-11-05" })));
  }

  return model;
};
