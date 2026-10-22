import { Option } from "effect";

import type { AppModel } from "../../app.js";
import { SaveCustomVideoLinks } from "./commands.js";
import { changeConferencingSettings } from "./machine.js";
import type { ConferencingSettingsChange } from "./model.js";
import { CustomVideoWrite, validateVideoDraft } from "./model.js";

export const updateConferencingSettings = (
  model: AppModel,
  personId: string,
  change: typeof ConferencingSettingsChange.Type
) => {
  if (!Option.contains(model.person, personId)) {
    return { model };
  }

  const previous = model.conferencingSettings;
  const next = changeConferencingSettings(previous, change);
  const updated = { ...model, conferencingSettings: next };

  if (next.mode === "saving" && previous.mode === "editing") {
    return Option.match(validateVideoDraft(next.draft).value, {
      onNone: () => ({ model }),
      onSome: (value) => ({
        commands: [
          SaveCustomVideoLinks({
            personId,
            requestId: next.requestId,
            write: CustomVideoWrite.cases.Save.make({
              ...value,
              id: next.draft.id,
            }),
          }),
        ],
        model: updated,
      }),
    });
  }

  if (next.mode === "removing" && previous.mode === "listing") {
    return Option.match(next.draft.id, {
      onNone: () => ({ model }),
      onSome: (id) => ({
        commands: [
          SaveCustomVideoLinks({
            personId,
            requestId: next.requestId,
            write: CustomVideoWrite.cases.Remove.make({ id }),
          }),
        ],
        model: updated,
      }),
    });
  }

  return { model: updated };
};
