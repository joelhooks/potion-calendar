import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppMessage, AppModel } from "../client/app.js";
import { Message } from "../client/app.js";
import { ConferencingSettingsChange } from "../client/settings/conferencing/model.js";
import { AccountSettingsRoute, printRoute } from "../layout/route.js";

export const settingsConferencing = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const state = model.conferencingSettings;

  const send = (change: typeof ConferencingSettingsChange.Type) =>
    Message.ChangedConferencingSettings({
      change,
      personId: Option.getOrElse(model.person, () => ""),
    });

  const accounts = (
    Option.getOrUndefined(AsyncData.getData(model.session))?.accounts ?? []
  ).filter((account) => !account.disconnected);

  const pending = state.mode === "saving" || state.mode === "removing";
  const editable = state.mode === "editing" || state.mode === "saving";
  const disabled = state.mode !== "listing" || Option.isNone(model.person);

  const operationError = Option.match(state.error, {
    onNone: () => [],
    onSome: (message) => [
      h.p([h.Role("alert"), h.Class("settings-conferencing-error")], [message]),
    ],
  });

  const fieldError = (field: "name" | "link") =>
    Option.match(state.errors[field], {
      onNone: () => [],
      onSome: (message) => [
        h.p(
          [
            h.Id(`custom-video-${field}-error`),
            h.Role("alert"),
            h.Class("settings-conferencing-error"),
          ],
          [message]
        ),
      ],
    });

  return [
    h.h1([], ["Conferencing"]),
    h.section(
      [h.Class("settings-section")],
      [
        h.h2([], ["Conferencing providers"]),
        h.div(
          [h.Class("settings-row")],
          [h.span([], ["Google Meet"]), h.span([], ["Connected by default"])]
        ),
      ]
    ),
    h.section(
      [h.Class("settings-section"), h.AriaLabel("Custom video links")],
      [
        h.h2([], ["Custom video links"]),
        h.p(
          [h.Class("settings-intro")],
          ["Saved on this browser. Custom links do not sync across devices."]
        ),
        ...(state.entries.length === 0 && !editable
          ? [h.p([h.Class("settings-intro")], ["No custom video links yet."])]
          : []),
        ...(state.entries.length > 0
          ? [
              h.ul(
                [h.Class("settings-conferencing-list")],
                state.entries.map((entry) =>
                  h.keyed("li")(
                    entry.id,
                    [h.Id(`custom-video-${entry.id}`)],
                    [
                      h.div(
                        [h.Class("settings-conferencing-entry")],
                        [
                          h.strong([], [entry.name]),
                          h.a(
                            [
                              h.Href(entry.link),
                              h.Target("_blank"),
                              h.Rel("noopener noreferrer"),
                            ],
                            [entry.link]
                          ),
                        ]
                      ),
                      h.div(
                        [h.Class("settings-conferencing-actions")],
                        [
                          h.button(
                            [
                              h.Type("button"),
                              h.Disabled(disabled),
                              h.AriaLabel(`Edit ${entry.name}`),
                              h.OnClick(
                                send(
                                  ConferencingSettingsChange.cases.Edit.make({
                                    id: entry.id,
                                  })
                                )
                              ),
                            ],
                            ["Edit"]
                          ),
                          h.button(
                            [
                              h.Type("button"),
                              h.Disabled(disabled),
                              h.AriaLabel(`Remove ${entry.name}`),
                              h.OnClick(
                                send(
                                  ConferencingSettingsChange.cases.Remove.make({
                                    id: entry.id,
                                  })
                                )
                              ),
                            ],
                            [
                              state.mode === "removing" &&
                              Option.contains(state.draft.id, entry.id)
                                ? "Removing…"
                                : "Remove",
                            ]
                          ),
                        ]
                      ),
                    ]
                  )
                )
              ),
            ]
          : []),
        ...(editable ? [] : operationError),
        ...(editable
          ? [
              h.form(
                [
                  h.Class("settings-conferencing-form"),
                  h.AriaLabel(
                    Option.isSome(state.draft.id)
                      ? "Edit custom video link"
                      : "Add custom video link"
                  ),
                  h.OnSubmit(
                    send(ConferencingSettingsChange.cases.Save.make({}))
                  ),
                ],
                [
                  h.h3(
                    [],
                    [
                      Option.isSome(state.draft.id)
                        ? "Edit custom video link"
                        : "Add custom video link",
                    ]
                  ),
                  h.label([h.For("custom-video-name")], ["Name"]),
                  h.input([
                    h.Id("custom-video-name"),
                    h.Type("text"),
                    h.Value(state.draft.name),
                    h.Disabled(pending),
                    h.OnInput((value) =>
                      send(
                        ConferencingSettingsChange.cases.Name.make({ value })
                      )
                    ),
                  ]),
                  ...fieldError("name"),
                  h.label([h.For("custom-video-link")], ["Conferencing link"]),
                  h.input([
                    h.Id("custom-video-link"),
                    h.Type("text"),
                    h.Value(state.draft.link),
                    h.Disabled(pending),
                    h.OnInput((value) =>
                      send(
                        ConferencingSettingsChange.cases.Link.make({ value })
                      )
                    ),
                  ]),
                  ...fieldError("link"),
                  ...operationError,
                  h.div(
                    [h.Class("settings-conferencing-actions")],
                    [
                      h.button(
                        [h.Type("submit"), h.Disabled(pending)],
                        [pending ? "Saving…" : "Save"]
                      ),
                      h.button(
                        [
                          h.Type("button"),
                          h.Disabled(pending),
                          h.OnClick(
                            send(
                              ConferencingSettingsChange.cases.Cancel.make({})
                            )
                          ),
                        ],
                        ["Cancel"]
                      ),
                      ...(state.mode === "saving"
                        ? [
                            h.span(
                              [h.Role("status"), h.Class("muted")],
                              ["Saving custom video link…"]
                            ),
                          ]
                        : []),
                    ]
                  ),
                ]
              ),
            ]
          : [
              h.button(
                [
                  h.Type("button"),
                  h.Disabled(disabled),
                  h.OnClick(
                    send(ConferencingSettingsChange.cases.Add.make({}))
                  ),
                ],
                ["Add custom video link"]
              ),
            ]),
        ...(state.mode === "removing"
          ? [h.p([h.Role("status")], ["Removing custom video link…"])]
          : []),
      ]
    ),
    h.section(
      [h.Class("settings-section")],
      [
        h.h2([], ["Default conferencing"]),
        h.p(
          [h.Class("settings-intro")],
          ["Choose default conferencing in each calendar account's settings."]
        ),
        ...(accounts.length === 0
          ? [
              h.p(
                [h.Class("muted")],
                ["Connect a calendar account to choose its default."]
              ),
            ]
          : accounts.map((account) =>
              h.a(
                [
                  h.Class("settings-account-link"),
                  h.Href(
                    printRoute(
                      AccountSettingsRoute.make({ accountId: account.id })
                    )
                  ),
                ],
                [account.email, h.span([h.AriaHidden(true)], [" →"])]
              )
            )),
      ]
    ),
  ];
};
