import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../client/app.js";
import type { AppMessage, AppModel } from "../client/app.js";
import { PrepareProfileDiscard } from "../client/settings/profile/dialog.js";
import {
  ProfileChange,
  profileImage,
  profileInitials,
} from "../client/settings/profile/model.js";
import { settingsDeleteAccount } from "./settings-delete-account.js";

const profileStyles = `
.profile-identity { display:flex; align-items:center; gap:16px; margin:20px 0; min-width:0; }
.profile-avatar { display:flex; flex:none; align-items:center; justify-content:center; width:64px; height:64px; border:1px solid var(--line); border-radius:50%; background:var(--surface-subtle); color:var(--text); font-size:22px; object-fit:cover; }
.profile-identity-copy { min-width:0; overflow-wrap:anywhere; }
.profile-identity-copy p { color:var(--muted); margin-top:4px; }
.settings-profile-form { box-sizing:border-box; width:100%; }
.settings-profile-form input { min-height:44px; }
.settings-profile-form .settings-dialog-actions { justify-content:flex-start; flex-wrap:wrap; }
.settings-profile-form button,.settings-profile-discard button { min-height:44px; }
.settings-profile-form [role=status] { color:var(--muted); }
.settings-profile-discard { box-sizing:border-box; }
.settings-profile-discard h2 { margin-bottom:12px; }
.settings-profile-discard .settings-dialog-actions { flex-wrap:wrap; }
`;

export const settingsProfile = (
  model: AppModel,
  h: HtmlBuilder<AppMessage>
): readonly Html[] => {
  const state = model.profile;

  const identity = Option.getOrUndefined(
    AsyncData.getData(model.session)
  )?.user;

  const name = identity?.name ?? "";

  const send = (change: typeof ProfileChange.Type) =>
    Message.ChangedProfile({
      change,
      personId: Option.getOrElse(model.person, () => ""),
    });

  const busy =
    state.mode === "saving" ||
    state.mode === "loading" ||
    state.mode === "idle" ||
    state.mode === "load-failed";

  const error = (message: string, id: string) =>
    h.p(
      [h.Id(id), h.Role("alert"), h.Class("settings-conferencing-error")],
      [message]
    );

  return [
    h.style([], [profileStyles]),
    h.h1([], ["Profile"]),
    h.div(
      [h.Class("profile-identity")],
      [
        Option.match(profileImage(identity?.image), {
          onNone: () =>
            h.span(
              [
                h.Class("profile-avatar"),
                h.Role("img"),
                h.AriaLabel(`Initials for ${name || "your profile"}`),
              ],
              [profileInitials(name)]
            ),
          onSome: (image) =>
            h.img([
              h.Class("profile-avatar"),
              h.Src(image),
              h.Alt(`Profile image for ${name}`),
              h.Referrerpolicy("no-referrer"),
            ]),
        }),
        h.div(
          [h.Class("profile-identity-copy")],
          [h.strong([], [name]), h.p([], [identity?.email ?? ""])]
        ),
      ]
    ),
    h.form(
      [
        h.Class("settings-conferencing-form settings-profile-form"),
        h.AriaLabel("Profile"),
        h.AriaBusy(state.mode === "saving" || state.mode === "loading"),
        h.OnSubmit(send(ProfileChange.cases.Save.make({}))),
      ],
      [
        h.label([h.For("profile-name")], ["Full name"]),
        h.input([
          h.Id("profile-name"),
          h.Name("name"),
          h.Type("text"),
          h.Autocomplete("name"),
          h.Value(state.draft),
          h.Disabled(busy),
          h.AriaRequired(true),
          h.AriaInvalid(Option.isSome(state.validation)),
          h.AriaDescribedBy(
            Option.isSome(state.validation)
              ? "profile-name-error"
              : "profile-name-help"
          ),
          h.OnInput((value) => send(ProfileChange.cases.Name.make({ value }))),
        ]),
        h.p(
          [h.Id("profile-name-help"), h.Class("muted")],
          ["Required. Up to 100 characters."]
        ),
        ...Option.match(state.validation, {
          onNone: () => [],
          onSome: (message) => [error(message, "profile-name-error")],
        }),
        ...Option.match(state.error, {
          onNone: () => [],
          onSome: (message) => [error(message, "profile-save-error")],
        }),
        ...(state.mode === "loading" || state.mode === "idle"
          ? [h.p([h.Role("status")], ["Loading profile…"])]
          : []),
        ...(state.mode === "saving"
          ? [h.p([h.Role("status")], ["Saving your name…"])]
          : []),
        ...(state.mode === "load-failed"
          ? [
              h.button(
                [
                  h.Type("button"),
                  h.OnClick(send(ProfileChange.cases.Retry.make({}))),
                ],
                ["Try again"]
              ),
            ]
          : []),
        h.div(
          [h.Class("settings-dialog-actions")],
          [
            h.button(
              [h.Type("submit"), h.Disabled(state.mode !== "editing")],
              ["Update"]
            ),
            h.button(
              [h.Type("button"), h.OnClick(Message.RequestedRouteBack())],
              ["Cancel"]
            ),
          ]
        ),
      ]
    ),
    ...(state.mode === "confirming"
      ? [
          h.keyed("dialog")(
            "profile-discard",
            [
              h.Id("profile-discard-dialog"),
              h.Class("settings-removal-dialog settings-profile-discard"),
              h.AriaLabel("Discard profile changes?"),
              h.OnMount(PrepareProfileDiscard()),
              h.OnCancelPreventDefault(
                send(ProfileChange.cases.Continue.make({}))
              ),
            ],
            [
              h.h2([], ["Discard profile changes?"]),
              h.p([], ["Discard the edits on this page or continue editing."]),
              h.div(
                [h.Class("settings-dialog-actions")],
                [
                  h.button(
                    [
                      h.Id("profile-continue"),
                      h.Type("button"),
                      h.OnClick(send(ProfileChange.cases.Continue.make({}))),
                    ],
                    ["Continue editing"]
                  ),
                  h.button(
                    [
                      h.Type("button"),
                      h.OnClick(send(ProfileChange.cases.Discard.make({}))),
                    ],
                    ["Discard"]
                  ),
                ]
              ),
            ]
          ),
        ]
      : []),
    ...settingsDeleteAccount(model, h),
  ];
};
