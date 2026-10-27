import {
  sameDesktopEventKey,
  trayRsvpNoteToken,
} from "@calendar/core/desktop-bridge";
import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import {
  freshRsvpNoteTarget,
  localRsvpDraftTarget,
} from "../client/desktop/rsvp-note.js";
import { EditorAction } from "../client/editing/editor-action.js";
import { bindingHints } from "../client/keyboard/registry.js";
import { isPhoneShell } from "../client/phone-shell/model.js";
import { nativeNotificationLease } from "../client/reminders/native-projection.js";
import type { DisplayEvent } from "../layout/presentation.js";
import { responseLabel } from "../layout/response-label.js";
import { rsvpSelf } from "../layout/rsvp-eligibility.js";

const preparedSource = (
  model: AppModel,
  selected: DisplayEvent
): Option.Option<{
  prepared: NonNullable<AppModel["editing"]["rsvp"]["prepared"]>;
  source: DisplayEvent["source"];
}> => {
  const { prepared } = model.editing.rsvp;

  if (
    prepared === undefined ||
    !Option.contains(model.person, prepared.intent.personId) ||
    nativeNotificationLease(model) !== prepared.intent.lease ||
    freshRsvpNoteTarget(model, prepared.intent) === undefined
  ) {
    return Option.none();
  }

  const copy = selected.copies.find((candidate) =>
    sameDesktopEventKey(candidate.source, prepared.intent.key)
  );

  return copy === undefined
    ? Option.none()
    : Option.some({ prepared, source: copy.source });
};

export const eventRsvp = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  selected: DisplayEvent
): readonly Html[] => {
  const current = model.editing.rsvp;
  const preparation = Option.getOrUndefined(preparedSource(model, selected));
  const active = preparation?.prepared;
  const target = localRsvpDraftTarget(model, selected);

  const source =
    target === undefined
      ? (preparation?.source ?? selected.source)
      : target.source;

  const self = source === undefined ? undefined : rsvpSelf(source);

  if (self === undefined && target === undefined) {
    return [];
  }

  const key = target?.binding.prepared.intent.key ?? selected.source;

  const focused =
    Option.isSome(current.focused) &&
    sameDesktopEventKey(current.focused.value, key);

  const saving =
    Option.isSome(current.saving) &&
    sameDesktopEventKey(current.saving.value.event, key);

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
        ...(active === undefined
          ? []
          : [
              h.p(
                [h.Role("status"), h.Class("editor-hint")],
                [
                  `Add a note for ${responseLabel(active.intent.response)}. Choose ${responseLabel(active.intent.response)} to send.`,
                ]
              ),
            ]),
        h.div(
          [h.Class("detail-actions")],
          choices.map((choice) =>
            h.button(
              [
                h.Disabled(saving || self === undefined),
                h.AriaPressed(String(self?.responseStatus === choice.response)),
                ...(active?.intent.response === choice.response && !saving
                  ? [h.DataAttribute("rsvp-staged", "true")]
                  : []),
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
        ...(target !== undefined && source === undefined
          ? [
              h.p(
                [h.Role("status"), h.Class("editor-hint")],
                [
                  "This meeting copy is no longer available. Your response note is kept.",
                ]
              ),
            ]
          : []),
        h.label(
          [h.Class("editor-field"), h.For("rsvp-note")],
          [
            h.span([], ["Optional note"]),
            h.textarea([
              h.Id("rsvp-note"),
              ...(active === undefined
                ? []
                : [
                    h.DataAttribute(
                      "tray-rsvp-note",
                      trayRsvpNoteToken(active.intent, active.id)
                    ),
                    ...(isPhoneShell(model) ? [h.Autofocus(true)] : []),
                  ]),
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
