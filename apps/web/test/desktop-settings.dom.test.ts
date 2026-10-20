import {
  DesktopPreferences,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { Scene } from "foldkit/test";

import type { DesktopUi } from "../src/client/desktop/model.js";
import { RemoteDesktop, initialDesktop } from "../src/client/desktop/model.js";
import { desktopMenuRows } from "../src/features/desktop-settings-menu.js";
import {
  desktopGeneralRows,
  desktopNotificationRows,
} from "../src/features/desktop-settings.js";

const Message = defineMessageUnion({
  Preferences: { preferences: DesktopPreferences },
  Read: {},
  Rejected: { message: Schema.String },
  Startup: { enabled: Schema.Boolean },
});

type UiMessage = typeof Message.Type;

type Model = typeof DesktopUi.Type;

const current = (preferences = defaultDesktopPreferences()): Model => ({
  ...initialDesktop(),
  availability: "available",
  settings: RemoteDesktop.Success({
    data: { issues: [], openAtLogin: false, preferences, revision: 1 },
  }),
});

const view = (state: Model, h: HtmlBuilder<UiMessage>) => {
  const actions = {
    preferences: (preferences: typeof DesktopPreferences.Type) =>
      Message.Preferences({ preferences }),
    read: Message.Read(),
    rejected: (message: string) => Message.Rejected({ message }),
    startup: (enabled: boolean) => Message.Startup({ enabled }),
  };

  return h.div(
    [],
    [
      ...desktopGeneralRows(state, h, actions),
      ...desktopMenuRows(state, h, actions),
      ...desktopNotificationRows(state, h, actions),
    ]
  );
};

const update = (model: Model, message: UiMessage) => ({
  model,
  outMessage: message,
});

it.effect(
  "Open calendar sends one desired toggle while retaining the observed OS value",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view },
        Scene.given(current()),
        Scene.expect(Scene.selector("#desktop-open-calendar")).toHaveValue(
          "off"
        ),
        Scene.change(Scene.selector("#desktop-open-calendar"), "on"),
        Scene.expectOutMessage(Message.Startup({ enabled: true })),
        Scene.expect(Scene.selector("#desktop-open-calendar")).toHaveValue(
          "off"
        ),
        Scene.expect(Scene.text("Start menu bar calendar")).toBeAbsent()
      );
    })
);

it.effect(
  "disabling menu bar disables includes, previews, shortcuts and prompts but not startup",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view },
        Scene.given(
          current({ ...defaultDesktopPreferences(), menuBar: false })
        ),
        Scene.expect(Scene.selector("#desktop-include-days")).toBeDisabled(),
        Scene.expect(Scene.selector("#desktop-preview-minutes")).toBeDisabled(),
        Scene.expect(Scene.selector("#desktop-menuShortcut")).toBeDisabled(),
        Scene.expect(Scene.selector("#desktop-joinShortcut")).toBeDisabled(),
        Scene.expect(Scene.selector("#desktop-prompt-minutes")).toBeDisabled(),
        Scene.expect(Scene.selector("#desktop-menu-bar")).toBeEnabled(),
        Scene.expect(Scene.selector("#desktop-open-calendar")).toBeEnabled()
      );
    })
);

it.effect(
  "Always uses the shared seven-day value and hidden title/time disable preview timing",
  () =>
    Effect.sync(() => {
      const preferences = defaultDesktopPreferences();
      Scene.scene(
        { update, view },
        Scene.given(current()),
        Scene.change(Scene.selector("#desktop-preview-minutes"), "10080"),
        Scene.expectOutMessage(
          Message.Preferences({
            preferences: { ...preferences, previewMinutes: 10_080 },
          })
        )
      );
      Scene.scene(
        { update, view },
        Scene.given(
          current({ ...preferences, showTime: false, showTitle: false })
        ),
        Scene.expect(Scene.selector("#desktop-preview-minutes")).toBeDisabled()
      );
    })
);

it.effect(
  "On and Off selections send the chosen value rather than invert a stale value",
  () =>
    Effect.sync(() => {
      const preferences = defaultDesktopPreferences();
      Scene.scene(
        { update, view },
        Scene.given(current()),
        Scene.change(Scene.selector("#desktop-menu-bar"), "on"),
        Scene.expectOutMessage(
          Message.Preferences({
            preferences: { ...preferences, menuBar: true },
          })
        )
      );
      Scene.scene(
        { update, view },
        Scene.given(current()),
        Scene.change(Scene.selector("#desktop-menu-bar"), "off"),
        Scene.expectOutMessage(
          Message.Preferences({
            preferences: { ...preferences, menuBar: false },
          })
        )
      );
      Scene.scene(
        { update, view },
        Scene.given(current()),
        Scene.change(Scene.selector("#desktop-menu-bar"), "unknown"),
        Scene.expectOutMessage(
          Message.Rejected({ message: "Choose an available desktop setting." })
        )
      );
    })
);

it.effect(
  "shortcut registration issues remain below the aligned controls",
  () =>
    Effect.sync(() => {
      const issue = "The join shortcut is unavailable and is now unset.";
      Scene.scene(
        { update, view },
        Scene.given({
          ...current(),
          settings: RemoteDesktop.Success({
            data: {
              issues: [issue],
              openAtLogin: false,
              preferences: defaultDesktopPreferences(),
              revision: 2,
            },
          }),
        }),
        Scene.expect(
          Scene.selector('.desktop-shortcut-status [role="alert"]')
        ).toExist(),
        Scene.expect(Scene.text(issue)).toExist()
      );
    })
);

it.effect("a normal browser never renders a fake login-item toggle", () =>
  Effect.sync(() => {
    Scene.scene(
      { update, view },
      Scene.given({
        ...initialDesktop(),
        availability: "unavailable",
        error: Option.none(),
      }),
      Scene.expect(Scene.selector("#desktop-open-calendar")).toBeAbsent(),
      Scene.expect(Scene.selector("#desktop-prompt-minutes")).toBeAbsent(),
      Scene.expect(
        Scene.text("Menu bar settings are available in the desktop app.")
      ).toExist()
    );
  })
);
