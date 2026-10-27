import { Option, Schema } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppMessage, AppModel } from "../client/app.js";
import { Message } from "../client/app.js";
import { UserDefaultConferencing } from "../client/settings/conferencing/default.js";
import { ConferencingSettingsChange } from "../client/settings/conferencing/model.js";

export const conferencingDefaultSettings = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const state = model.conferencingSettings;

  const value = Option.getOrElse(
    state.pendingDefault,
    () => state.defaultConferencing
  );

  return [
    h.label(
      [h.Class("settings-row"), h.For("user-default-conferencing")],
      [
        h.span([], ["Your default"]),
        h.select(
          [
            h.Id("user-default-conferencing"),
            h.AriaLabel("Your default conferencing"),
            h.Disabled(state.mode !== "listing" || Option.isNone(model.person)),
            h.Value(value ?? "none"),
            h.OnChange((raw) =>
              Option.match(
                Schema.decodeUnknownOption(UserDefaultConferencing)(
                  raw === "none" ? null : raw
                ),
                {
                  onNone: () => Message.Navigated(),
                  onSome: (choice) =>
                    Message.ChangedConferencingSettings({
                      change: ConferencingSettingsChange.cases.Default.make({
                        value: choice,
                      }),
                      personId: Option.getOrElse(model.person, () => ""),
                    }),
                }
              )
            ),
          ],
          [
            h.option(
              [h.Value("none"), h.Selected(value === null)],
              ["No conferencing"]
            ),
            h.option(
              [h.Value("googleMeet"), h.Selected(value === "googleMeet")],
              ["Google Meet"]
            ),
          ]
        ),
      ]
    ),
    h.p(
      [h.Class("settings-intro")],
      [
        "Applies when an account is Not set. Saved on this browser; this preference does not sync across devices.",
      ]
    ),
    ...(state.mode === "savingDefault"
      ? [h.p([h.Role("status")], ["Saving default conferencing…"])]
      : []),
    ...Option.match(state.defaultError, {
      onNone: () => [],
      onSome: (error) => [
        h.p([h.Role("alert"), h.Class("settings-conferencing-error")], [error]),
      ],
    }),
  ];
};
