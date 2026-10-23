import { Option, Predicate } from "effect";

import type { AppModel } from "../app.js";
import { isPhoneShell } from "../phone-shell/model.js";

export const zoneDragHostKey = (model: AppModel): Option.Option<string> =>
  !isPhoneShell(model) &&
  Option.isSome(model.person) &&
  Predicate.isTagged(model.route, "Calendar") &&
  model.calendar.navigation.mode !== "month"
    ? Option.some(
        JSON.stringify([
          model.person.value,
          model.timeZones.preferences.secondary,
          model.timeZones.preferences.primary,
          Option.getOrUndefined(model.timeZones.temporary),
        ])
      )
    : Option.none();

export const zoneDragScopeKey = (model: AppModel): Option.Option<string> =>
  Option.map(zoneDragHostKey(model), () =>
    JSON.stringify([
      Option.getOrThrow(model.person),
      model.timeZones.preferences.primary.id,
      Option.getOrUndefined(model.timeZones.temporary)?.id,
    ])
  );
