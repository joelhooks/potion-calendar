import { Option } from "effect";

import type { AppModel } from "../../app.js";
import { loadConferencingAccounts } from "../../conferencing/update.js";
import {
  LoadCustomVideoLinks,
  SaveCustomVideoLinks,
  SaveDefaultConferencing,
} from "./commands.js";
import { changeConferencingSettings } from "./machine.js";
import {
  ConferencingSettingsChange,
  CustomVideoWrite,
  validateVideoDraft,
} from "./model.js";

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

  if (next.mode === "loading" && previous.mode !== "loading") {
    return {
      commands: [
        LoadCustomVideoLinks({
          entries: next.legacyEntries,
          personId,
          requestId: next.requestId,
        }),
      ],
      model: updated,
    };
  }

  if (next.mode === "savingDefault" && previous.mode === "listing") {
    return Option.match(next.pendingDefault, {
      onNone: () => ({ model }),
      onSome: (value) => ({
        commands: [
          SaveDefaultConferencing({
            personId,
            requestId: next.requestId,
            value,
          }),
        ],
        model: updated,
      }),
    });
  }

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
              create: next.draft.create ?? Option.isNone(next.draft.id),
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

  if (
    (ConferencingSettingsChange.guards.Saved(change) ||
      ConferencingSettingsChange.guards.Loaded(change)) &&
    next !== previous
  ) {
    return loadConferencingAccounts(
      updated,
      Object.keys(model.conferencing.accounts),
      true
    );
  }

  return { model: updated };
};
