import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message } from "../src/client/app.js";
import type { AppMessage } from "../src/client/app.js";
import {
  DesktopRequest,
  RemoteDesktop,
  initialDesktop,
} from "../src/client/desktop/model.js";
import type { DesktopUi } from "../src/client/desktop/model.js";
import { desktopSettingsView } from "../src/features/desktop-settings-actions.js";
import { desktopNotificationRows } from "../src/features/desktop-settings.js";

const current = (
  preferences = defaultDesktopPreferences()
): typeof DesktopUi.Type => ({
  ...initialDesktop(),
  availability: "available",
  settings: RemoteDesktop.Success({
    data: { issues: [], openAtLogin: false, preferences, revision: 1 },
  }),
});

const view = (state: typeof DesktopUi.Type, h: HtmlBuilder<AppMessage>) =>
  h.div([], desktopSettingsView(state, h, desktopNotificationRows));

const update = (model: typeof DesktopUi.Type, message: AppMessage) => ({
  model,
  outMessage: message,
});

it.effect.each(["none", "blip", "bell", "tap"] as const)(
  "the actual sound select saves %s with an explicit user-change preview marker",
  (promptSound) =>
    Effect.sync(() => {
      const preferences = defaultDesktopPreferences();

      Scene.scene(
        { update, view },
        Scene.given(current()),
        Scene.tap<typeof DesktopUi.Type, AppMessage, AppMessage>(({ html }) => {
          const value = Scene.find("#desktop-prompt-sound")(html).pipe(
            Option.flatMap(Scene.attr("value"))
          );

          expect(Option.getOrUndefined(value)).toBe("blip");
        }),
        Scene.change(Scene.selector("#desktop-prompt-sound"), promptSound),
        Scene.tap<typeof DesktopUi.Type, AppMessage, AppMessage>(
          ({ outMessage }) => {
            expect(outMessage).toEqual(
              Message.RequestedDesktop({
                request: DesktopRequest.cases.Save.make({
                  preferences: { ...preferences, promptSound },
                  previewSound: promptSound !== "blip",
                  request: 1,
                }),
              })
            );
          }
        )
      );
    })
);

it.effect.each([
  { menuBar: false, promptMinutes: 1 },
  { menuBar: true, promptMinutes: null },
] as const)(
  "sound is disabled for menuBar=$menuBar and promptMinutes=$promptMinutes",
  (settings) =>
    Effect.sync(() => {
      Scene.scene(
        { update, view },
        Scene.given(current({ ...defaultDesktopPreferences(), ...settings })),
        Scene.tap<typeof DesktopUi.Type, AppMessage, AppMessage>(({ html }) => {
          const disabled = Scene.find("#desktop-prompt-sound")(html).pipe(
            Option.flatMap(Scene.attr("disabled"))
          );

          expect(Option.getOrUndefined(disabled)).toBe("true");
        })
      );
    })
);

it.effect("ordinary browser settings omit the desktop-only sound control", () =>
  Effect.sync(() => {
    Scene.scene(
      { update, view },
      Scene.given({ ...current(), availability: "unavailable" }),
      Scene.tap<typeof DesktopUi.Type, AppMessage, AppMessage>(({ html }) => {
        expect(Option.isNone(Scene.find("#desktop-prompt-sound")(html))).toBe(
          true
        );
      })
    );
  })
);
