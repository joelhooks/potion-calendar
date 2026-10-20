import { Option } from "effect";

import { zoneCatalog, zoneOffset } from "../../layout/time-zones-display.js";
import type { AppModel } from "../app.js";
import type { CommandChoice } from "../keyboard/choices.js";
import { Message } from "../message.js";
import { EditorAction } from "./editor-action.js";
import { EditorView } from "./editor-model.js";

const catalog = zoneCatalog();

export const eventZoneChoices = (model: AppModel): readonly CommandChoice[] => {
  const { view } = model.editing;

  if (
    EditorView.guards.Closed(view) ||
    EditorView.guards.Loading(view) ||
    EditorView.guards.Saving(view) ||
    !view.permissions.editMeeting ||
    view.draft.allDay
  ) {
    return [];
  }

  const query = model.keyboard.query.trim().toLowerCase();

  return catalog
    .map((zone): CommandChoice => ({
      disabled: false,
      exact:
        query === zone.id.toLowerCase() || query === zone.city.toLowerCase(),
      id: zone.id,
      keys: [],
      message: Message.EditingAction({
        action: EditorAction.cases.TimeZoneSelected.make({ value: zone.id }),
        personId: Option.getOrUndefined(model.person),
      }),
      score: 1,
      section: "Time zones",
      title: `${zone.city} · ${zone.region} · ${zone.id} · ${zoneOffset(model.calendar.now, zone.id)}`,
    }))
    .filter(
      (entry) => query === "" || entry.title.toLowerCase().includes(query)
    );
};
