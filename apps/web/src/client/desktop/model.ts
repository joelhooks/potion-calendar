import {
  DesktopAction,
  DesktopPreferences,
  DesktopSettings,
  MacStartupTarget,
} from "@calendar/core/desktop-bridge";
import { Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { NotificationSettingsUi } from "./notification-model.js";

export const RemoteDesktop = AsyncData.Schema(DesktopSettings, Schema.String);

export const DesktopRequest = Schema.TaggedUnion({
  Read: { request: Schema.Int },
  Save: {
    preferences: DesktopPreferences,
    previewSound: Schema.optional(Schema.Boolean),
    request: Schema.Int,
  },
  Startup: {
    enabled: Schema.Boolean,
    request: Schema.Int,
    target: Schema.optional(MacStartupTarget),
  },
});

export const DesktopOutcome = Schema.TaggedUnion({
  Failed: { message: Schema.String },
  Ready: { error: Schema.Option(Schema.String), settings: DesktopSettings },
  Unavailable: {},
});

export const DesktopNotice = Schema.TaggedUnion({
  Action: { action: DesktopAction },
  Finished: {
    canSaveIcs: Schema.optional(Schema.Boolean),
    canShowAbout: Schema.optional(Schema.Boolean),
    outcome: DesktopOutcome,
    request: Schema.Int,
  },
  Rejected: { message: Schema.String },
  Settings: { settings: DesktopSettings },
});

export const DesktopUi = Schema.Struct({
  availability: Schema.Literals(["unknown", "unavailable", "available"]),
  canSaveIcs: Schema.optional(Schema.Boolean),
  canShowAbout: Schema.optional(Schema.Boolean),
  error: Schema.Option(Schema.String),
  notificationLease: Schema.optional(Schema.String),
  notificationRevision: Schema.optional(Schema.Int),
  notificationSettings: Schema.optional(NotificationSettingsUi),
  request: Schema.Int,
  settings: RemoteDesktop.schema,
});

export const initialDesktop = (): typeof DesktopUi.Type => ({
  availability: "unknown",
  canSaveIcs: false,
  error: Option.none(),
  request: 0,
  settings: RemoteDesktop.Idle(),
});
