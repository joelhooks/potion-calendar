import { statusEventType } from "@calendar/calendar/contracts";
import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import { eventKey } from "../client/calendar-state.js";
import { EditorAction } from "../client/editing/editor-action.js";
import { bindingHints } from "../client/keyboard/registry.js";
import type { DisplayEvent } from "../layout/presentation.js";
import { responseLabel } from "../layout/response-label.js";

export const eventRsvp = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  selected: DisplayEvent
): readonly Html[] => {
  const self = selected.source.attendees?.find(
    (person) => person.self === true
  );

  if (self === undefined || statusEventType(selected.source.eventType)) {
    return [];
  }

  const current = model.editing.rsvp;

  const focused =
    Option.isSome(current.focused) &&
    eventKey(current.focused.value) === eventKey(selected.source);

  const saving =
    Option.isSome(current.saving) &&
    eventKey(current.saving.value.event) === eventKey(selected.source);

  const choices: readonly {
    readonly response: "accepted" | "declined" | "tentative";
    readonly shortcutId: string;
  }[] = [
    { response: "accepted", shortcutId: "rsvp-yes" },
    { response: "declined", shortcutId: "rsvp-no" },
    { response: "tentative", shortcutId: "rsvp-maybe" },
  ];

  return [
    h.section(
      [h.Class("event-rsvp"), h.AriaLabel("Your response")],
      [
        h.h3([], ["Your response"]),
        h.div(
          [h.Class("detail-actions")],
          choices.map((choice) =>
            h.button(
              [
                h.Disabled(saving),
                h.AriaPressed(String(self.responseStatus === choice.response)),
                h.OnClick(
                  Message.EditingAction({
                    action: EditorAction.cases.Rsvp.make({
                      response: choice.response,
                    }),
                  })
                ),
              ],
              [responseLabel(choice.response)]
            )
          )
        ),
        h.label(
          [h.Class("editor-field"), h.For("rsvp-note")],
          [
            h.span([], ["Optional note"]),
            h.textarea([
              h.Id("rsvp-note"),
              h.Value(focused ? current.note : ""),
              h.Disabled(saving),
              h.OnInput((value) =>
                Message.EditingAction({
                  action: EditorAction.cases.RsvpNoteEdited.make({ value }),
                })
              ),
            ]),
          ]
        ),
        ...(model.keyboard.prefix === "e"
          ? [
              h.p(
                [h.Role("status"), h.Class("editor-hint")],
                [
                  choices
                    .map(
                      (choice) =>
                        `${bindingHints(choice.shortcutId).join(" / ")} ${responseLabel(choice.response)}`
                    )
                    .join(" · "),
                ]
              ),
            ]
          : []),
        ...(saving
          ? [
              h.p(
                [h.Role("status"), h.Class("editor-hint")],
                ["Saving your response…"]
              ),
            ]
          : []),
      ]
    ),
  ];
};
