import { watchActor } from "@calendar/capability/actor-watch";
import {
  NotificationSettingsReply,
  NotificationSettingsRequest,
  notificationSettingsReplyMatches,
} from "@calendar/core/desktop-bridge";
import { createEffectActor, createEffectLogic, join } from "@xstate/effect";
import { Effect, Match, Option, Predicate, Schema } from "effect";
import { AsyncData, Command } from "foldkit";
import type { Update } from "foldkit";

import type { AppModel, AppMessage } from "../app.js";
import { Message } from "../message.js";
import { browserDesktop } from "./commands.js";
import {
  NotificationSettingsChange,
  RemoteMacNotificationPermission,
  RemoteNotificationSettingsOperation,
  initialNotificationSettings,
} from "./notification-model.js";

const failed = () =>
  NotificationSettingsReply.cases.Failed.make({
    message:
      "Desktop notification settings are unavailable. Use the Apple menu to open Notifications.",
    version: 1,
  });

export const ApplyNotificationSettings = Command.define(
  "ApplyNotificationSettings",
  {
    args: { operation: NotificationSettingsRequest, request: Schema.Int },
    execute: ({ request, operation }) =>
      Effect.gen(function* applyNotificationSettings() {
        const logic = createEffectLogic({
          effect: ({
            input,
          }: {
            readonly input: typeof NotificationSettingsRequest.Type;
          }) =>
            Effect.gen(function* isolatedNotificationSettings() {
              const invoke =
                Option.getOrUndefined(browserDesktop())?.notificationSettings;

              if (invoke === undefined) {
                return NotificationSettingsReply.cases.Unavailable.make({
                  version: 1,
                });
              }

              const reply = yield* Effect.tryPromise({
                catch: failed,
                // @effect-diagnostics-next-line asyncFunction:off -- The isolated preload supplies a native Promise for this typed operation.
                try: async () => await invoke(input),
              }).pipe(
                Effect.flatMap((value) =>
                  Schema.decodeEffect(NotificationSettingsReply, {
                    onExcessProperty: "error",
                  })(value)
                )
              );

              return notificationSettingsReplyMatches(input, reply)
                ? reply
                : failed();
            }).pipe(Effect.orElseSucceed(failed)),
        });

        const actor = yield* createEffectActor(logic, { input: operation });
        yield* watchActor("browserNotificationSettings", actor);
        const reply = yield* join(actor).pipe(Effect.orDie);

        return Message.ChangedDesktopNotificationSettings({
          change: NotificationSettingsChange.cases.Finished.make({
            reply,
            request,
          }),
        });
      }).pipe(Effect.scoped),
    messages: [Message.ChangedDesktopNotificationSettings],
  }
);

type Result = Update.Return<AppModel, AppMessage>;

export const updateNotificationSettings = (
  model: AppModel,
  change: typeof NotificationSettingsChange.Type
): Result => {
  if (model.desktop.availability !== "available") {
    return { model };
  }

  const current =
    model.desktop.notificationSettings ?? initialNotificationSettings();

  const withState = (notificationSettings: typeof current): AppModel => ({
    ...model,
    desktop: { ...model.desktop, notificationSettings },
  });

  return Match.value(change).pipe(
    Match.tagsExhaustive({
      Finished: ({ request, reply }): Result => {
        const expected =
          current.action === "Read"
            ? NotificationSettingsRequest.cases.Read.make({ version: 1 })
            : NotificationSettingsRequest.cases.Open.make({ version: 1 });

        if (
          request !== current.request ||
          !Predicate.isTagged(current.operation, "Loading") ||
          !notificationSettingsReplyMatches(expected, reply)
        ) {
          return { model };
        }

        if (Predicate.isTagged(reply, "Failed")) {
          return {
            model: withState({
              ...current,
              operation: RemoteNotificationSettingsOperation.Failure({
                error: reply.message,
              }),
              permission:
                current.action === "Read"
                  ? RemoteMacNotificationPermission.Failure({
                      error: reply.message,
                    })
                  : current.permission,
            }),
          };
        }

        return {
          model: withState({
            ...current,
            operation: RemoteNotificationSettingsOperation.Success({
              data: reply,
            }),
            permission: Predicate.isTagged(reply, "Read")
              ? RemoteMacNotificationPermission.Success({
                  data: reply.permission,
                })
              : current.permission,
          }),
        };
      },
      Open: (): Result => {
        if (
          Predicate.isTagged(current.operation, "Loading") ||
          Option.isNone(AsyncData.getData(current.permission))
        ) {
          return { model };
        }

        const request = current.request + 1;

        return {
          commands: [
            ApplyNotificationSettings({
              operation: NotificationSettingsRequest.cases.Open.make({
                version: 1,
              }),
              request,
            }),
          ],
          model: withState({
            ...current,
            action: "Open",
            operation: RemoteNotificationSettingsOperation.Loading(),
            request,
          }),
        };
      },
      Read: (): Result => {
        if (Predicate.isTagged(current.operation, "Loading")) {
          return { model };
        }

        const request = current.request + 1;

        return {
          commands: [
            ApplyNotificationSettings({
              operation: NotificationSettingsRequest.cases.Read.make({
                version: 1,
              }),
              request,
            }),
          ],
          model: withState({
            ...current,
            action: "Read",
            operation: RemoteNotificationSettingsOperation.Loading(),
            permission: RemoteMacNotificationPermission.Loading(),
            request,
          }),
        };
      },
    })
  );
};

export const readNotificationSettingsForRoute = (model: AppModel): Result =>
  model.desktop.availability === "available" &&
  Predicate.isTagged(model.route, "Settings") &&
  model.route.page === "notifications" &&
  model.desktop.notificationSettings === undefined
    ? updateNotificationSettings(
        model,
        NotificationSettingsChange.cases.Read.make({})
      )
    : { model };
