import { Calendar, CalendarEvent } from "@calendar/calendar/contracts";
import { Schema } from "effect";

export const NotificationPermission = Schema.Literals([
  "default",
  "denied",
  "granted",
  "unsupported",
]);

export const ReminderCandidate = Schema.Struct({
  body: Schema.String,
  calendar: Calendar,
  end: Schema.Finite,
  event: CalendarEvent,
  identity: Schema.String,
  key: Schema.String,
  start: Schema.Finite,
  title: Schema.String,
});

export type ReminderCandidateValue = typeof ReminderCandidate.Type;

export const ReminderCardAction = Schema.Literals([
  "join",
  "show",
  "email",
  "dismiss",
]);

export const ReminderCard = Schema.Struct({
  kind: Schema.Literals(["upcoming", "reminder"]),
  state: Schema.Literals(["active", "resolved"]),
});

export const NotificationContent = Schema.Struct({
  candidate: ReminderCandidate,
  card: Schema.optional(ReminderCard),
  id: Schema.String,
  personId: Schema.String,
  title: Schema.String,
});

export type NotificationContentValue = typeof NotificationContent.Type;

export const NotificationEvent = Schema.TaggedUnion({
  Clicked: { notification: NotificationContent },
  Closed: { id: Schema.String, personId: Schema.String },
  Failed: { id: Schema.String, personId: Schema.String },
  Permission: { permission: NotificationPermission, personId: Schema.String },
});

export class NotificationFailure extends Schema.TaggedError<NotificationFailure>()(
  "NotificationFailure",
  {
    reason: Schema.Literals([
      "unsupported",
      "delivery",
      "permission",
      "inactive",
      "expired",
    ]),
  }
) {}

export const PermissionOutcome = Schema.TaggedUnion({
  Failed: { failure: NotificationFailure },
  Observed: { permission: NotificationPermission },
});

export const ReminderMemory = Schema.Struct({
  accepted: Schema.Option(Schema.Int),
  active: Schema.Array(NotificationContent),
  close: Schema.Array(Schema.String),
  coverage: Schema.Option(Schema.Finite),
  deliveries: Schema.Array(NotificationContent),
  dismissedPrompts: Schema.optional(Schema.Array(Schema.String)),
  fired: Schema.Array(Schema.String),
  invitations: Schema.Record(
    Schema.String,
    Schema.Struct({ answered: Schema.Boolean, version: Schema.String })
  ),
  lastChecked: Schema.Option(Schema.Finite),
  permission: NotificationPermission,
  scope: Schema.String,
});

export const ReminderState = Schema.Struct({
  context: ReminderMemory,
  failure: Schema.Option(Schema.String),
  value: Schema.Literals([
    "permissionUnknown",
    "requesting",
    "denied",
    "granted",
    "scanning",
    "stopped",
  ]),
});

export const ReminderScan = Schema.Struct({
  accepted: Schema.Option(
    Schema.Struct({
      origin: Schema.Literals(["live", "snapshot"]),
      request: Schema.Int,
    })
  ),
  candidates: Schema.Array(ReminderCandidate),
  eventInvites: Schema.Boolean,
  now: Schema.Finite,
  personId: Schema.String,
  scope: Schema.String,
  webCards: Schema.optional(Schema.Boolean),
});
