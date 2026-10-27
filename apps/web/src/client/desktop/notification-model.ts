import {
  MacNotificationPermission,
  NotificationSettingsReply,
} from "@calendar/core/desktop-bridge";
import { Schema } from "effect";
import { AsyncData } from "foldkit";

export const RemoteMacNotificationPermission = AsyncData.Schema(
  MacNotificationPermission,
  Schema.String
);

export const RemoteNotificationSettingsOperation = AsyncData.Schema(
  NotificationSettingsReply,
  Schema.String
);

export const NotificationSettingsChange = Schema.TaggedUnion({
  Finished: { reply: NotificationSettingsReply, request: Schema.Int },
  Open: {},
  Read: {},
});

export const NotificationSettingsUi = Schema.Struct({
  action: Schema.Literals(["Read", "Open"]),
  operation: RemoteNotificationSettingsOperation.schema,
  permission: RemoteMacNotificationPermission.schema,
  request: Schema.Int,
});

export const initialNotificationSettings =
  (): typeof NotificationSettingsUi.Type => ({
    action: "Read",
    operation: RemoteNotificationSettingsOperation.Idle(),
    permission: RemoteMacNotificationPermission.Idle(),
    request: 0,
  });
