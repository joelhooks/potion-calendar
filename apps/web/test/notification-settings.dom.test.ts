import {
  NotificationSettingsRequest,
  NotificationSettingsReply,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { Scene } from "foldkit/test";
import { fromString } from "foldkit/url";

import { Message, update } from "../src/client/app.js";
import {
  NotificationSettingsChange,
  initialNotificationSettings,
} from "../src/client/desktop/notification-model.js";
import { ApplyNotificationSettings } from "../src/client/desktop/notification-settings.js";
import { DispatchEditing } from "../src/client/editing/commands.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { PrepareKeyboard } from "../src/client/keyboard/mount.js";
import { view } from "../src/features/app.js";
import { browserIcsBridge } from "./desktop-ics-fixture.js";
import { notificationSettingsFixture } from "./notification-settings-fixture.js";

it.effect(
  "the actual Notifications recipient requests System Settings only after its explicit Open click",
  () =>
    Effect.sync(() => {
      Scene.scene(
        { update, view },
        Scene.given(notificationSettingsFixture()),
        Scene.Mount.resolve(PrepareKeyboard, Message.KeyboardClose()),
        Scene.Mount.resolve(
          PrepareEditingDialogs,
          Message.EditingAction({ action: EditorAction.cases.Cancel.make({}) })
        ),
        Scene.Command.resolve(DispatchEditing, Message.DispatchedEditing()),
        Scene.expect(
          Scene.text("Permission status: Check System Settings")
        ).toExist(),
        Scene.expect(
          Scene.selector("#desktop-notification-settings-open")
        ).toBeEnabled(),
        Scene.click(Scene.selector("#desktop-notification-settings-open")),
        Scene.expect(
          Scene.selector("#desktop-notification-settings-open")
        ).toBeDisabled(),
        Scene.Command.resolve(
          ApplyNotificationSettings,
          Message.ChangedDesktopNotificationSettings({
            change: NotificationSettingsChange.cases.Finished.make({
              reply: NotificationSettingsReply.cases.Requested.make({
                version: 1,
              }),
              request: 2,
            }),
          })
        ),
        Scene.expect(
          Scene.text(
            "System Settings was requested. Check the Notifications pane."
          )
        ).toExist(),
        Scene.expect(
          Scene.selector("#desktop-notification-settings-open")
        ).toBeEnabled()
      );
    })
);

it.effect.prop(
  "positive request correlation preserves native permission Unknown and rejects old or operation-mismatched results",
  {
    stale: Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 1 })),
  },
  ({ stale }) =>
    Effect.sync(() => {
      const base = notificationSettingsFixture();

      const model = {
        ...base,
        desktop: {
          ...base.desktop,
          notificationSettings: {
            ...(base.desktop.notificationSettings ??
              initialNotificationSettings()),
            request: stale + 1,
          },
        },
      };

      const pending = update(
        model,
        Message.ChangedDesktopNotificationSettings({
          change: NotificationSettingsChange.cases.Open.make({}),
        })
      );

      expect(pending.commands).toHaveLength(1);
      expect(pending.commands?.[0]?.args).toEqual({
        operation: NotificationSettingsRequest.cases.Open.make({ version: 1 }),
        request: stale + 2,
      });

      for (const change of [
        NotificationSettingsChange.cases.Finished.make({
          reply: NotificationSettingsReply.cases.Requested.make({ version: 1 }),
          request: stale,
        }),
        NotificationSettingsChange.cases.Finished.make({
          reply: NotificationSettingsReply.cases.Read.make({
            permission: { authorization: "unknown", supported: false },
            version: 1,
          }),
          request: stale + 2,
        }),
      ]) {
        expect(
          update(
            pending.model,
            Message.ChangedDesktopNotificationSettings({ change })
          ).model
        ).toBe(pending.model);
      }

      expect(
        update(
          pending.model,
          Message.ChangedDesktopNotificationSettings({
            change: NotificationSettingsChange.cases.Open.make({}),
          })
        ).commands
      ).toBeUndefined();

      const failed = update(
        pending.model,
        Message.ChangedDesktopNotificationSettings({
          change: NotificationSettingsChange.cases.Finished.make({
            reply: NotificationSettingsReply.cases.Failed.make({
              message: "Handoff refused",
              version: 1,
            }),
            request: stale + 2,
          }),
        })
      );

      expect(failed.model.desktop.notificationSettings?.operation._tag).toBe(
        "Failure"
      );
      expect(failed.model.desktop.notificationSettings?.permission).toEqual(
        model.desktop.notificationSettings?.permission
      );
    })
);

it.effect(
  "browser granted denied and default keep their existing copy and never expose a native settings control",
  () =>
    Effect.gen(function* unchangedBrowserPermission() {
      for (const [scene, copy] of [
        [
          "granted",
          "Browser notifications are allowed. Reminders run while Calendar is open.",
        ],
        [
          "denied",
          "Browser notifications are blocked. Allow notifications in your browser's site settings.",
        ],
        ["default", "Browser notifications are not yet enabled."],
      ] as const) {
        const model = notificationSettingsFixture(scene);

        const result = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const dom = new DOMParser().parseFromString(result.html, "text/html");
        expect(dom.body.textContent).toContain(copy);
        expect(
          dom.querySelector("#desktop-notification-settings-open")
        ).toBeNull();
        expect(
          update(
            model,
            Message.ChangedDesktopNotificationSettings({
              change: NotificationSettingsChange.cases.Open.make({}),
            })
          ).model
        ).toBe(model);
      }
    })
);

it.effect(
  "a read through the real browser command never opens or fabricates native authorization",
  () =>
    Effect.gen(function* unavailableNativeSettings() {
      expect(window.potionDesktop).toBeUndefined();

      const reply = yield* ApplyNotificationSettings({
        operation: NotificationSettingsRequest.cases.Read.make({ version: 1 }),
        request: 1,
      }).effect;

      expect(reply).toEqual(
        Message.ChangedDesktopNotificationSettings({
          change: NotificationSettingsChange.cases.Finished.make({
            reply: NotificationSettingsReply.cases.Unavailable.make({
              version: 1,
            }),
            request: 1,
          }),
        })
      );
      expect(Option.isNone(Option.fromUndefinedOr(window.potionDesktop))).toBe(
        true
      );
    })
);

it.effect(
  "the real root and named browser command preserve separate Read and explicit Open intents through the supplied native bridge",
  () =>
    Effect.gen(function* actualRootNotificationSettings() {
      expect(window.potionDesktop).toBeUndefined();
      const calls: (typeof NotificationSettingsRequest.Type)[] = [];
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const bridge = {
            ...browserIcsBridge(),
            // oxlint-disable-next-line typescript/promise-function-async -- The faithful isolated preload stand-in returns a native Promise without another Effect runtime.
            notificationSettings: (
              request: typeof NotificationSettingsRequest.Type
            ) => {
              calls.push(request);

              return Promise.resolve(
                Predicate.isTagged(request, "Read")
                  ? NotificationSettingsReply.cases.Read.make({
                      permission: { authorization: "unknown", supported: true },
                      version: 1,
                    })
                  : NotificationSettingsReply.cases.Requested.make({
                      version: 1,
                    })
              );
            },
          };

          Object.defineProperty(window, "potionDesktop", {
            configurable: true,
            value: bridge,
          });
        }),
        () =>
          Effect.sync(() => {
            Reflect.deleteProperty(window, "potionDesktop");
          })
      );
      const base = notificationSettingsFixture();
      const { notificationSettings: omitted, ...desktop } = base.desktop;
      expect(omitted).toBeDefined();
      const unread = { ...base, desktop };

      const navigation = update(
        unread,
        Message.BrowserUrlChanged({
          url: Option.getOrThrow(
            fromString("https://calendar.example.test/settings/notifications")
          ),
        })
      );

      const read = navigation.commands?.find(
        (command) => command.name === "ApplyNotificationSettings"
      );

      expect(read?.args).toEqual({
        operation: NotificationSettingsRequest.cases.Read.make({ version: 1 }),
        request: 1,
      });
      expect(calls).toEqual([]);

      const readReply = yield* ApplyNotificationSettings({
        operation: NotificationSettingsRequest.cases.Read.make({ version: 1 }),
        request: 1,
      }).effect;

      const ready = update(navigation.model, readReply).model;
      expect(calls).toEqual([
        NotificationSettingsRequest.cases.Read.make({ version: 1 }),
      ]);

      const opened = update(
        ready,
        Message.ChangedDesktopNotificationSettings({
          change: NotificationSettingsChange.cases.Open.make({}),
        })
      );

      expect(opened.commands?.[0]?.args).toEqual({
        operation: NotificationSettingsRequest.cases.Open.make({ version: 1 }),
        request: 2,
      });

      const openReply = yield* ApplyNotificationSettings({
        operation: NotificationSettingsRequest.cases.Open.make({ version: 1 }),
        request: 2,
      }).effect;

      const done = update(opened.model, openReply);
      expect(calls).toEqual([
        NotificationSettingsRequest.cases.Read.make({ version: 1 }),
        NotificationSettingsRequest.cases.Open.make({ version: 1 }),
      ]);
      expect(done.model.desktop.notificationSettings?.operation._tag).toBe(
        "Success"
      );
      expect(done.model.desktop.notificationSettings?.permission).toEqual(
        ready.desktop.notificationSettings?.permission
      );
    }).pipe(Effect.scoped)
);
