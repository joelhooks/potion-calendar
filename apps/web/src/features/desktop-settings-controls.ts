import type { DesktopPreferencesValue } from "@calendar/core/desktop-bridge";
import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { DesktopUi } from "../client/desktop/model.js";

export interface DesktopSettingsActions<Message> {
  readonly preferences: (
    preferences: DesktopPreferencesValue,
    previewSound?: boolean
  ) => Message;
  readonly read: Message;
  readonly rejected: (message: string) => Message;
  readonly startup: (enabled: boolean) => Message;
}

export const desktopBusy = (state: typeof DesktopUi.Type): boolean =>
  AsyncData.isLoading(state.settings) || AsyncData.isRefreshing(state.settings);

export const desktopStatus = <Message>(
  state: typeof DesktopUi.Type,
  h: HtmlBuilder<Message>,
  actions: DesktopSettingsActions<Message>
): readonly Html[] => {
  const issues = Option.match(AsyncData.getData(state.settings), {
    onNone: () => [],
    onSome: (data) => data.issues,
  });

  const error = Option.match(state.error, {
    onNone: () => [],
    onSome: (message) => [message],
  });

  const messages = [...new Set([...issues, ...error])];

  return [
    ...messages.map((message) => h.p([h.Role("alert")], [message])),
    ...(desktopBusy(state)
      ? [h.p([h.Role("status")], ["Reading desktop settings…"])]
      : []),
    ...(AsyncData.isFailure(state.settings) || AsyncData.isStale(state.settings)
      ? [
          h.button(
            [h.Type("button"), h.OnClick(actions.read)],
            ["Retry desktop settings"]
          ),
        ]
      : []),
  ];
};

export const desktopChoice = <Message, Value extends string | number | null>(
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  value: Value,
  options: readonly (readonly [Value, string])[],
  disabled: boolean,
  change: (value: Value) => Message,
  rejected: (message: string) => Message
): Html =>
  h.label(
    [h.Class("settings-row"), h.For(id)],
    [
      h.span([], [label]),
      h.select(
        [
          h.Id(id),
          h.Value(String(value)),
          h.Disabled(disabled),
          h.OnChange((raw) => {
            const selected = options.find(([key]) => String(key) === raw);

            return selected === undefined
              ? rejected("Choose an available desktop setting.")
              : change(selected[0]);
          }),
        ],
        options.map(([key, text]) =>
          h.option([h.Value(String(key)), h.Selected(key === value)], [text])
        )
      ),
    ]
  );
