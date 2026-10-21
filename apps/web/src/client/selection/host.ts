import { Option } from "effect";

import type { AppModel } from "../app.js";
import { EditorView } from "../editing/editor-model.js";
import {
  acceptsGesture,
  modelGestureHostKey,
} from "../editing/gesture-targets.js";
import { monthHostKey } from "../month/host.js";

export const selectionHostKey = (model: AppModel) =>
  model.calendar.navigation.mode === "month"
    ? monthHostKey(model)
    : modelGestureHostKey(model).pipe(
        Option.map((key) => JSON.stringify([key, model.calendar.navigation]))
      );

export const acceptsSelection = (
  model: AppModel,
  personId: string,
  hostKey: string
): boolean =>
  EditorView.guards.Closed(model.editing.view) &&
  model.action === "idle" &&
  Option.contains(model.person, personId) &&
  Option.contains(selectionHostKey(model), hostKey) &&
  (acceptsGesture(
    model,
    personId,
    Option.getOrUndefined(modelGestureHostKey(model))
  ) ||
    Option.contains(monthHostKey(model), hostKey));
