import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { OccurrenceNotice } from "../client/selection-commands/model.js";
import { ownsOccurrenceTask } from "../client/selection-commands/source.js";

const occurrenceStatusText = (notice: typeof OccurrenceNotice.Type): string => {
  const forward = notice.task.request.direction === "next";

  if (OccurrenceNotice.guards.Ready(notice)) {
    return forward ? "No later occurrence" : "No earlier occurrence";
  }

  if (OccurrenceNotice.guards.Failed(notice)) {
    return `Couldn't find the ${forward ? "next" : "previous"} occurrence`;
  }

  return `Finding ${forward ? "next" : "previous"} occurrence…`;
};

export const selectionCommandStatus = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const notice = Option.getOrUndefined(model.selectionCommands.notice);

  if (notice === undefined || !ownsOccurrenceTask(model, notice.task)) {
    return [];
  }

  if (OccurrenceNotice.guards.Ready(notice) && notice.event !== null) {
    return [];
  }

  return [
    h.p(
      [
        h.Role(OccurrenceNotice.guards.Failed(notice) ? "alert" : "status"),
        h.DataAttribute("selection-command-status", notice._tag),
        h.Style({
          background: "var(--surface)",
          border: "1px solid var(--border)",
          "border-radius": "8px",
          bottom: "16px",
          "max-width": "calc(100vw - 32px)",
          padding: "12px",
          position: "fixed",
          right: "16px",
          "z-index": "20",
        }),
      ],
      [occurrenceStatusText(notice)]
    ),
  ];
};
