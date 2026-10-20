import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { EventDraftValue } from "../client/editing/editor-model.js";
import { eventZonePreview } from "../layout/event-zone-preview.js";
import type { ResolvedTimeFormat } from "../layout/time-format.js";

export const editorZoneExplanation = <Message>(
  h: HtmlBuilder<Message>,
  props: {
    readonly draft: EventDraftValue;
    readonly primaryZone: string;
    readonly timeFormat: ResolvedTimeFormat;
  }
): readonly Html[] => {
  if (props.draft.allDay) {
    return [];
  }

  const preview = eventZonePreview(
    props.draft,
    props.primaryZone,
    props.timeFormat
  );

  return [
    h.div(
      [
        h.Id("event-zone-explanation"),
        h.Class("editor-hint"),
        h.AriaLive("polite"),
      ],
      [
        h.p([], ["Changing the zone keeps the dates and times you entered."]),
        h.p(
          [],
          [
            Option.getOrElse(
              preview,
              () =>
                "Primary-zone preview is unavailable for this date, time or zone."
            ),
          ]
        ),
      ]
    ),
  ];
};
