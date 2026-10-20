import { Schema } from "effect";

import type { AppModel } from "../app.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import { SettingsChange } from "../settings/model.js";
import type { KeyboardResult } from "./update.js";

export const PanelAction = Schema.Literals([
  "sidebar",
  "context",
  "sidebars",
  "show-context",
]);

type Apply = (model: AppModel, message: AppMessage) => KeyboardResult;

const context = (
  model: AppModel,
  shown: boolean,
  apply: Apply
): KeyboardResult =>
  model.settings.hideContextPanel === !shown
    ? { model }
    : apply(
        model,
        Message.ChangedSettings({
          change: SettingsChange.cases.ContextPanel.make({ shown }),
        })
      );

export const panelAction = (
  model: AppModel,
  id: typeof PanelAction.Type,
  apply: Apply
): KeyboardResult => {
  switch (id) {
    case "sidebar": {
      return {
        model: {
          ...model,
          keyboard: { ...model.keyboard, sidebar: !model.keyboard.sidebar },
        },
      };
    }

    case "context": {
      return context(model, model.settings.hideContextPanel, apply);
    }

    case "show-context": {
      return context(model, true, apply);
    }

    case "sidebars": {
      const shown = !model.keyboard.sidebar || model.settings.hideContextPanel;

      return context(
        { ...model, keyboard: { ...model.keyboard, sidebar: shown } },
        shown,
        apply
      );
    }

    default: {
      return { model };
    }
  }
};
