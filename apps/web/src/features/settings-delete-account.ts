import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppMessage, AppModel } from "../client/app.js";
import { PrepareAccountDeletionDialog } from "../client/settings/delete-account/dialog.js";
import { AccountDeletionChange } from "../client/settings/delete-account/model.js";

const deleteAccountStyles = `
.settings-delete-account { border-top:1px solid var(--line); margin-top:32px; padding-top:24px; min-width:0; }
.settings-delete-account p { margin:12px 0; line-height:1.6; color:var(--muted); }
.settings-delete-account button,.settings-delete-dialog button { min-height:44px; }
.settings-delete-dialog { box-sizing:border-box; width:min(440px,calc(100vw - 32px)); max-width:calc(100vw - 32px); max-height:calc(100dvh - 32px); overflow-y:auto; }
.settings-delete-dialog h2 { margin-bottom:12px; overflow-wrap:anywhere; }
.settings-delete-dialog p { line-height:1.6; overflow-wrap:anywhere; }
.settings-delete-dialog .settings-dialog-actions { flex-wrap:wrap; }
.settings-delete-confirm { color:var(--error); }
`;

export const settingsDeleteAccount = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const state = model.accountDeletion;
  const snapshot = Option.getOrUndefined(AsyncData.getData(model.session));

  const proofReady =
    snapshot !== undefined &&
    snapshot !== null &&
    snapshot.accountDeletionProof !== undefined;

  const busy = state.mode === "deleting";

  const send = (change: typeof AccountDeletionChange.Type) =>
    Message.ChangedAccountDeletion({
      change,
      personId: Option.getOrElse(model.person, () => ""),
    });

  return [
    h.style([], [deleteAccountStyles]),
    h.section(
      [h.Class("settings-delete-account"), h.AriaLabel("Delete account")],
      [
        h.h2([], ["Delete account"]),
        h.p(
          [],
          [
            "Permanently remove your Potion Calendar data. Your calendars and contacts stored with Google are not deleted.",
          ]
        ),
        h.button(
          [
            h.Id("delete-account-open"),
            h.Type("button"),
            h.Disabled(
              !proofReady ||
                model.profile.mode === "saving" ||
                model.profile.mode === "confirming" ||
                busy
            ),
            h.OnClick(send(AccountDeletionChange.cases.Open.make({}))),
          ],
          ["Delete account…"]
        ),
      ]
    ),
    ...(state.mode === "confirming" || state.mode === "failed" || busy
      ? [
          h.keyed("dialog")(
            "account-deletion",
            [
              h.Id("delete-account-dialog"),
              h.Tabindex(-1),
              h.Class("settings-removal-dialog settings-delete-dialog"),
              h.AriaLabel("Delete your Potion Calendar account?"),
              h.AriaDescribedBy("delete-account-retention"),
              h.AriaBusy(busy),
              h.OnMount(
                PrepareAccountDeletionDialog({
                  personId: Option.getOrElse(model.person, () => ""),
                })
              ),
            ],
            [
              h.h2([], ["Delete your Potion Calendar account?"]),
              h.p(
                [h.Id("delete-account-retention")],
                [
                  "Your Potion Calendar data, including settings, connected-account links, and sessions, will be permanently deleted. Calendars and contacts stored with Google are not deleted. Potion Calendar will still appear in your Google account's third-party access list until you remove it there.",
                ]
              ),
              ...Option.match(state.error, {
                onNone: () => [],
                onSome: (message) => [
                  h.p(
                    [
                      h.Id("delete-account-error"),
                      h.Role("alert"),
                      h.Class("settings-conferencing-error"),
                    ],
                    [message]
                  ),
                ],
              }),
              ...(busy
                ? [h.p([h.Role("status")], ["Deleting your account…"])]
                : []),
              h.div(
                [h.Class("settings-dialog-actions")],
                [
                  h.button(
                    [
                      h.Id("delete-account-cancel"),
                      h.Type("button"),
                      h.Disabled(busy),
                      h.OnClick(
                        send(AccountDeletionChange.cases.Cancel.make({}))
                      ),
                    ],
                    ["Cancel"]
                  ),
                  h.button(
                    [
                      h.Id("delete-account-confirm"),
                      h.Type("button"),
                      h.Class("settings-delete-confirm"),
                      h.Disabled(busy),
                      h.OnClick(
                        send(AccountDeletionChange.cases.Confirm.make({}))
                      ),
                    ],
                    [busy ? "Deleting…" : "Permanently delete account"]
                  ),
                ]
              ),
            ]
          ),
        ]
      : []),
  ];
};
