import {
  statusEventAvailability,
  statusEventType,
} from "@calendar/calendar/contracts";
import type { Html, HtmlBuilder } from "foldkit/html";

import { EditorAction } from "../client/editing/editor-action.js";
import { EditorView } from "../client/editing/editor-model.js";
import type { EditorProps } from "./editor-fields.js";

const labels = {
  birthday: "Birthday",
  default: "Event",
  focusTime: "Focus time",
  fromGmail: "From Gmail",
  outOfOffice: "Out of office",
  workingLocation: "Working location",
};

export const eventTypeField = <Message>(
  h: HtmlBuilder<Message>,
  props: EditorProps<Message>
): Html => {
  const { draft } = props.model;

  if (props.model.kind === "edit") {
    return h.p(
      [
        h.Class("editor-hint"),
        h.DataAttribute("saved-event-type", draft.eventType ?? "default"),
      ],
      [`Event type: ${labels[draft.eventType ?? "default"]}`]
    );
  }

  const calendar = props.calendars.find(
    (item) =>
      item.accountId === draft.accountId && item.calendarId === draft.calendarId
  );

  const availability = statusEventAvailability(calendar, draft.allDay);

  const busy =
    EditorView.guards.Saving(props.model) ||
    !props.model.permissions.editMeeting;

  return h.section(
    [
      h.Class("editor-section"),
      h.AriaLabel("Event type"),
      h.DataAttribute("status-entitlement", availability.kind),
    ],
    [
      h.label(
        [h.Class("editor-field"), h.For("event-type")],
        [
          h.span([], ["Event type"]),
          h.select(
            [
              h.Id("event-type"),
              h.Value(draft.eventType ?? "default"),
              h.Disabled(busy),
              h.OnInput((value) =>
                props.send(EditorAction.cases.EventTypeSelected.make({ value }))
              ),
            ],
            [
              h.option([h.Value("default")], ["Event"]),
              h.option(
                [
                  h.Value("focusTime"),
                  h.Disabled(availability.kind === "ineligible"),
                ],
                ["Focus time"]
              ),
              h.option(
                [
                  h.Value("outOfOffice"),
                  h.Disabled(availability.kind === "ineligible"),
                ],
                ["Out of office"]
              ),
            ]
          ),
        ]
      ),
      ...(availability.kind === "ineligible"
        ? [
            h.p(
              [h.Class("editor-hint"), h.Id("event-type-reason")],
              [availability.reason]
            ),
          ]
        : []),
      ...(statusEventType(draft.eventType)
        ? [
            h.label(
              [h.Class("editor-check")],
              [
                h.input([
                  h.Id("event-status-invitations"),
                  h.Type("checkbox"),
                  h.Checked(
                    draft.statusInvitationChoice ===
                      "declineOnlyNewConflictingInvitations"
                  ),
                  h.Disabled(busy),
                  h.OnClick(
                    props.send(
                      EditorAction.cases.StatusInvitationsChosen.make({
                        value:
                          draft.statusInvitationChoice !==
                          "declineOnlyNewConflictingInvitations",
                      })
                    )
                  ),
                ]),
                "Decline new invitations during this time",
              ]
            ),
            h.p(
              [h.Class("editor-hint")],
              [
                "Focus time and Out of office have no guests. Saving sends no invitation emails.",
              ]
            ),
          ]
        : []),
    ]
  );
};
