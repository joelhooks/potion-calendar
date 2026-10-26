import { Option } from "effect";

import type { AppModel } from "../app.js";
import { DownloadSelectedIcs } from "./browser.js";
import type { IcsExportNotice } from "./model.js";
import { IcsSelection, selectedIcsEvents } from "./selection.js";

export const beginIcsExport = (model: AppModel) => {
  const selection = selectedIcsEvents(model);

  if (IcsSelection.guards.Refused(selection)) {
    return selection.reason === "missingSource" && Option.isSome(model.person)
      ? {
          model: {
            ...model,
            icsExport: {
              ...model.icsExport,
              notice: Option.some({
                message:
                  "A selected event is no longer available. Select the events again before exporting.",
                personId: model.person.value,
                revision: model.icsExport.revision,
              }),
            },
          },
        }
      : { model };
  }

  const revision = model.icsExport.revision + 1;
  const saving = model.desktop.availability === "available";
  const phase: "idle" | "saving" = saving ? "saving" : "idle";

  return {
    commands: [
      DownloadSelectedIcs({
        events: selection.events,
        personId: selection.personId,
        revision,
      }),
    ],
    model: {
      ...model,
      icsExport: {
        notice: saving
          ? Option.some({
              message: "Saving…",
              personId: selection.personId,
              revision,
            })
          : Option.none(),
        phase,
        revision,
      },
    },
  };
};

export const receiveIcsExport = (
  model: AppModel,
  notice: typeof IcsExportNotice.Type
): AppModel =>
  Option.contains(model.person, notice.personId) &&
  notice.revision === model.icsExport.revision
    ? {
        ...model,
        icsExport: {
          ...model.icsExport,
          notice: Option.some(notice),
          phase: "idle",
        },
      }
    : model;
