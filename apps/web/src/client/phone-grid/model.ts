import { Option, Predicate, Schema } from "effect";

import type { AppModel } from "../app.js";
import { EditorView } from "../editing/editor-model.js";
import { monthNavigation } from "../month/host.js";
import { isPhoneShell } from "../phone-shell/model.js";
import { displayedZones } from "../time-zones/model.js";

export const PhoneGrid = Schema.Struct({
  defaultView: Schema.Literals(["pending", "settled"]),
});

export const initialPhoneGrid = (): typeof PhoneGrid.Type => ({
  defaultView: "pending",
});

export const gridZones = (model: AppModel) =>
  isPhoneShell(model)
    ? [
        model.timeZones.preferences.primary,
        ...Option.toArray(model.timeZones.temporary),
      ]
    : displayedZones(model.timeZones);

export const phoneSwipeKey = (model: AppModel): Option.Option<string> => {
  if (
    !isPhoneShell(model) ||
    Option.isNone(model.person) ||
    !Predicate.isTagged(model.route, "Calendar") ||
    model.phoneShell.mode !== "closed" ||
    model.keyboard.screen !== "closed" ||
    !EditorView.guards.Closed(model.editing.view)
  ) {
    return Option.none();
  }

  const navigation = monthNavigation(model);

  return Option.some(
    JSON.stringify({
      anchor: navigation.anchor,
      days: navigation.days,
      mode: navigation.mode,
      person: model.person.value,
      zone: model.calendar.zone,
    })
  );
};
