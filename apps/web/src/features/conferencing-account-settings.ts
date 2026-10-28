import type { CustomVideoLinks } from "@calendar/calendar/contracts";
import {
  ConferencingDefault,
  customVideoReference,
} from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel, AppMessage } from "../client/app.js";
import { Message } from "../client/app.js";
import {
  ConferencingChange,
  RemoteConferencingDefault,
} from "../client/conferencing/model.js";

const LegacyChoice = Schema.Literals(["unset", "none", "googleMeet"]);

const choices = LegacyChoice.literals;

const labels: Record<typeof LegacyChoice.Type, string> = {
  googleMeet: "Google Meet",
  none: "None",
  unset: "Not set",
};

const descriptions: Record<typeof LegacyChoice.Type, string> = {
  googleMeet:
    "Adds Meet when you invite another person to a new event without conferencing.",
  none: "Do not add conferencing automatically.",
  unset: "Inherits your default conferencing on this browser.",
};

const catalogIsReady = (model: AppModel) =>
  model.conferencingSettings.mode !== "loading" &&
  model.conferencingSettings.mode !== "unconfirmed";

const choiceValue = (
  value: typeof ConferencingDefault.Type | undefined
): string =>
  customVideoReference(value) ? `custom:${value.id}` : (value ?? "");

const choiceDescription = (
  value: typeof ConferencingDefault.Type | undefined,
  links: typeof CustomVideoLinks.Type
): string => {
  if (value === undefined) {
    return "";
  }

  if (customVideoReference(value)) {
    const name =
      links.find((entry) => entry.id === value.id)?.name ??
      "the saved custom link";

    return `Adds ${name} to the description when you invite another person to a new event without conferencing.`;
  }

  return descriptions[value];
};

const choiceInput = (raw: string, links: typeof CustomVideoLinks.Type) => {
  const entry = links.find((candidate) => raw === `custom:${candidate.id}`);

  return Schema.decodeUnknownOption(ConferencingDefault)(
    entry === undefined ? raw : { id: entry.id, kind: "customLink" }
  );
};

const unavailableOption = (
  h: HtmlBuilder<AppMessage>,
  value: typeof ConferencingDefault.Type | undefined,
  links: typeof CustomVideoLinks.Type
): readonly Html[] => {
  if (
    !customVideoReference(value) ||
    links.some((entry) => entry.id === value.id)
  ) {
    return [];
  }

  return [
    h.option(
      [h.Selected(true), h.Value(choiceValue(value)), h.Disabled(true)],
      ["Saved link unavailable — reload preferences"]
    ),
  ];
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
  const catalogReady = catalogIsReady(model);
  const links = catalogReady ? model.conferencingSettings.entries : [];
  const selected = choiceValue(value);
  const description = choiceDescription(value, links);

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
                  busy ||
                    !catalogReady ||
                    AsyncData.hasError(remote) ||
                    Option.isNone(data)
                ),
                h.Id(id),
                h.OnChange((raw) =>
                  Option.match(choiceInput(raw, links), {
                    onNone: () => Message.Navigated(),
                    onSome: (choice) =>
                      Message.ChangedConferencing({
                        change: ConferencingChange.cases.Set.make({
                          accountId,
                          value: choice,
                        }),
                      }),
                  })
                ),
                h.Value(selected),
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
                ...unavailableOption(h, value, links),
                ...links.map((entry) =>
                  h.option(
                    [
                      h.Selected(selected === `custom:${entry.id}`),
                      h.Value(`custom:${entry.id}`),
                    ],
                    [entry.name]
                  )
                ),
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
              h.p([h.Class("muted")], [description]),
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
