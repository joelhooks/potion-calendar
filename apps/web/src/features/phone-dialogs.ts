import { Predicate } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { AppModel } from "../client/app.js";
import { EditorView } from "../client/editing/editor-model.js";
import { isPhoneShell } from "../client/phone-shell/model.js";

export const phoneDialogCss = `
@media (max-width: 640px) {
  #keyboard-command-dialog[open],
  .editor-dialog[open],
  dialog[data-phone-route-dialog][open] {
    box-sizing: border-box;
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    width: 100vw !important;
    max-width: 100vw !important;
    height: 100dvh !important;
    max-height: 100dvh !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    overflow: hidden;
    color: var(--text);
    background: var(--surface);
  }

  #keyboard-command-dialog > header,
  .editor-dialog .editor-heading,
  .phone-sheet-heading {
    flex-shrink: 0;
    padding-top: max(12px, env(safe-area-inset-top)) !important;
    overflow-wrap: anywhere;
  }

  #keyboard-command-dialog > header > label,
  .editor-dialog .editor-heading h2,
  .phone-sheet-heading h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
  }

  #keyboard-command-dialog > header > button,
  .editor-dialog .editor-close,
  .phone-sheet-heading > button {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
  }

  #keyboard-command-dialog > input {
    flex-shrink: 0;
  }

  #keyboard-choices {
    flex: 1;
    min-height: 0;
    max-height: none !important;
    padding-bottom: max(12px, env(safe-area-inset-bottom)) !important;
    overscroll-behavior-y: contain;
  }

  #keyboard-choices button {
    min-height: 44px;
    overflow-wrap: anywhere;
  }

  #keyboard-command-dialog > footer,
  .editor-dialog .editor-footer {
    flex-shrink: 0;
    padding-bottom: max(12px, env(safe-area-inset-bottom)) !important;
  }

  .editor-dialog form {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .editor-dialog .editor-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior-y: contain;
  }

  .editor-dialog .editor-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .editor-dialog .editor-field {
    min-width: 0;
  }

  .editor-dialog button,
  .editor-dialog .editor-colour {
    min-width: 44px;
    min-height: 44px;
  }

  .editor-dialog a,
  .phone-sheet-body a {
    display: inline-flex;
    align-items: center;
    min-width: 44px;
    min-height: 44px;
  }

  .editor-dialog label:has(input[type="checkbox"], input[type="radio"]),
  .phone-sheet-body label:has(input[type="checkbox"], input[type="radio"]) {
    display: inline-flex;
    align-items: center;
    min-width: 44px;
    min-height: 44px;
    gap: 8px;
  }

  .phone-sheet-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }

  .phone-sheet-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .phone-sheet-body .settings-shell {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  .phone-sheet-body .settings-nav {
    display: flex;
    flex: 0 0 auto;
    flex-direction: row;
    gap: 8px;
    max-width: 100%;
    padding: 8px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    white-space: nowrap;
  }

  .phone-sheet-body .settings-nav > a,
  .phone-sheet-body .settings-nav > button {
    flex-shrink: 0;
    min-height: 44px;
  }

  .phone-sheet-body .settings-content {
    flex: 1;
    min-height: 0;
    min-width: 0;
    padding: 16px;
    overflow-y: auto;
    overscroll-behavior-y: contain;
  }

  .phone-sheet-body button {
    min-width: 44px;
    min-height: 44px;
  }

  .phone-sheet-body #search-panel > header {
    flex-shrink: 0;
    padding: 12px 16px !important;
  }

  .phone-sheet-body #search-panel > header > h1 {
    display: none;
  }

  .phone-sheet-body #search-results {
    overscroll-behavior-y: contain;
  }

  .phone-sheet-body #search-results button[data-search-event] {
    grid-template-columns: minmax(0, 1fr) !important;
    gap: 6px !important;
  }

  #keyboard-command-dialog input,
  .editor-dialog input,
  .editor-dialog select,
  .editor-dialog textarea,
  .phone-sheet-body input,
  .phone-sheet-body select,
  .phone-sheet-body textarea {
    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    font-size: 16px !important;
  }

  #keyboard-command-dialog input,
  .editor-dialog input:not([type="checkbox"]):not([type="radio"]),
  .editor-dialog select,
  .phone-sheet-body input:not([type="checkbox"]):not([type="radio"]),
  .phone-sheet-body select {
    min-height: 44px;
  }

  #keyboard-command-dialog > header > label {
    font-size: 18px !important;
    font-weight: 600;
  }

  #keyboard-command-dialog > header > button {
    color: var(--text);
    font-size: 22px;
    font-weight: 600;
  }
}
`;

export const phoneDialogStyles = <Message>(
  model: AppModel,
  h: HtmlBuilder<Message>
): readonly Html[] =>
  isPhoneShell(model) &&
  (model.keyboard.screen !== "closed" ||
    !EditorView.guards.Closed(model.editing.view) ||
    Predicate.isTagged(model.route, "Settings") ||
    Predicate.isTagged(model.route, "Search"))
    ? [h.style([h.Id("phone-dialog-styles")], [phoneDialogCss])]
    : [];

export interface PhoneRouteSheetProps<Message> {
  readonly body: readonly Html[];
  readonly close: Message;
  readonly closeLabel: string;
  readonly id: string;
  readonly initialFocus: string;
  readonly title: string;
}

export const phoneRouteSheet = <Message>(
  h: HtmlBuilder<Message>,
  props: PhoneRouteSheetProps<Message>
): Html =>
  h.keyed("dialog")(
    props.id,
    [
      h.Id(props.id),
      h.DataAttribute("phone-route-dialog", props.id),
      h.DataAttribute("initial-focus", props.initialFocus),
      h.AriaLabel(props.title),
      h.AriaModal(true),
    ],
    [
      h.header(
        [h.Class("phone-sheet-heading")],
        [
          h.h1([], [props.title]),
          h.button(
            [
              h.Id(`${props.id}-close`),
              h.Type("button"),
              h.AriaLabel(props.closeLabel),
              h.OnClick(props.close),
            ],
            ["×"]
          ),
        ]
      ),
      h.div([h.Class("phone-sheet-body")], props.body),
    ]
  );
