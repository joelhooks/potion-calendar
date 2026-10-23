import { Predicate } from "effect";

import type { AppModel, AppMessage } from "../app.js";
import { phoneShellMode } from "./machine.js";
import { isPhoneShell } from "./model.js";

export const afterPhoneShellMessage = (
  model: AppModel,
  message: AppMessage
): AppModel => {
  if (!isPhoneShell(model)) {
    return model;
  }

  const close =
    !Predicate.isTagged(model.route, "Calendar") ||
    Predicate.isTagged(message, "ClosedDetail");

  const selected =
    (Predicate.isTagged(message, "ClickedEvent") ||
      Predicate.isTagged(message, "ModifiedEventSelection")) &&
    model.calendar.selected.length > 0;

  const selectionMode = selected ? "details" : model.phoneShell.mode;

  const mode = close ? "closed" : selectionMode;

  return mode === model.phoneShell.mode
    ? model
    : {
        ...model,
        phoneShell: {
          ...model.phoneShell,
          mode: phoneShellMode(model.phoneShell.mode, mode),
        },
      };
};
