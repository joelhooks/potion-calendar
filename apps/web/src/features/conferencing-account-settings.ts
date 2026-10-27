import { ConferencingDefault } from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import {
  ConferencingChange,
  RemoteConferencingDefault,
} from "../client/conferencing/model.js";

const choices: readonly (typeof ConferencingDefault.Type)[] = [
  "unset",
  "none",
  "googleMeet",
];

const labels: Record<typeof ConferencingDefault.Type, string> = {
  googleMeet: "Google Meet",
  none: "None",
  unset: "Not set",
};

const descriptions: Record<typeof ConferencingDefault.Type, string> = {
  googleMeet:
    "Adds Meet when you invite another person to a new event without conferencing.",
  none: "Do not add conferencing automatically.",
  unset: "Inherits your default conferencing on this browser.",
};

export const conferencingAccountSettings = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>,
  accountId: string
): readonly Html[] => {
  const state = Object.hasOwn(model.conferencing.accounts, accountId)
    ? model.conferencing.accounts[accountId]
    : undefined;

  const remote = state?.remote ?? RemoteConferencingDefault.Idle();
  const data = AsyncData.getData(remote);
  const value = Option.getOrUndefined(data)?.value;
  const error = AsyncData.getError(remote);
  const busy = AsyncData.isPending(remote);
  const id = `conferencing-default-${accountId}`;

  return [
    h.section(
      [h.Class("settings-section")],
      [
        h.h2([], ["Conferencing"]),
        h.label(
          [h.Class("settings-row"), h.For(id)],
          [
            h.span([], ["Default conferencing"]),
            h.select(
              [
                h.Disabled(
                  busy || AsyncData.hasError(remote) || Option.isNone(data)
                ),
                h.Id(id),
                h.OnChange((raw) =>
                  Option.match(
                    Schema.decodeUnknownOption(ConferencingDefault)(raw),
                    {
                      onNone: () => Message.Navigated(),
                      onSome: (choice) =>
                        Message.ChangedConferencing({
                          change: ConferencingChange.cases.Set.make({
                            accountId,
                            value: choice,
                          }),
                        }),
                    }
                  )
                ),
                h.Value(value ?? ""),
              ],
              [
                ...(value === undefined
                  ? [
                      h.option(
                        [h.Selected(true), h.Value("")],
                        [busy ? "Loading…" : "Preference unavailable"]
                      ),
                    ]
                  : []),
                ...choices.map((choice) =>
                  h.option(
                    [h.Selected(choice === value), h.Value(choice)],
                    [labels[choice]]
                  )
                ),
              ]
            ),
          ]
        ),
        ...(value === undefined
          ? []
          : [
              h.p([h.Class("muted")], [descriptions[value]]),
              ...(value === "unset"
                ? [
                    h.p(
                      [h.Class("muted")],
                      [
                        `Your default: ${model.conferencingSettings.defaultConferencing === "googleMeet" ? "Google Meet" : "No conferencing"}.`,
                      ]
                    ),
                  ]
                : []),
            ]),
        ...(busy
          ? [
              h.p(
                [h.Class("muted"), h.Role("status")],
                [
                  state?.operation === "write"
                    ? "Saving…"
                    : "Loading preference…",
                ]
              ),
            ]
          : []),
        ...Option.match(error, {
          onNone: () => [],
          onSome: (problem) => [h.p([h.Role("alert")], [problem.message])],
        }),
        ...(AsyncData.hasError(remote) || AsyncData.isIdle(remote)
          ? [
              h.button(
                [
                  h.Disabled(busy),
                  h.OnClick(
                    Message.ChangedConferencing({
                      change: ConferencingChange.cases.Load.make({
                        accountId,
                        refresh: true,
                      }),
                    })
                  ),
                  h.Type("button"),
                ],
                ["Reload preference"]
              ),
            ]
          : []),
      ]
    ),
  ];
};
