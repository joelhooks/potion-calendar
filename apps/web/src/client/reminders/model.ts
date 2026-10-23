import { Calendar, CalendarEvent } from "@calendar/calendar/contracts";
import { Match, Option, Schema } from "effect";

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

export const ReminderSnooze = Schema.Struct({
  due: Schema.Finite.check(
    Schema.isBetween({
      maximum: 8_640_000_000_000_000,
      minimum: -8_640_000_000_000_000,
    })
  ),
  identity: Schema.String,
});

export const reminderSnoozeMinutes = [1, 5, 15, 30, 60, 1440] as const;

export const reminderSnoozeElementId = (personId: string, id: string): string =>
  `reminder-snooze:${JSON.stringify([personId, id])}`;

export const ReminderSnoozeChoice = Schema.Literals([
  ...reminderSnoozeMinutes,
  "start",
]);

export const ReminderSnoozeRestore = Schema.TaggedUnion({
  Failed: {},
  Restored: { entries: Schema.Array(ReminderSnooze) },
});

export const ReminderSnoozeStorage = Schema.TaggedUnion({
  Failed: {},
  Loading: {},
  Ready: {},
  Sampling: {
    choice: ReminderSnoozeChoice,
    id: Schema.String,
    identity: Schema.String,
    persistence: Schema.Literals(["durable", "session"]),
  },
  Saving: { entry: ReminderSnooze, id: Schema.String },
  Unloaded: {},
});

export const reminderSnoozeCanStart = (
  storage: typeof ReminderSnoozeStorage.Type | undefined
): boolean =>
  ReminderSnoozeStorage.guards.Ready(storage) ||
  ReminderSnoozeStorage.guards.Failed(storage);

export const reminderSnoozeIsSessionOnly = (
  storage: typeof ReminderSnoozeStorage.Type | undefined
): boolean =>
  ReminderSnoozeStorage.guards.Failed(storage) ||
  (ReminderSnoozeStorage.guards.Sampling(storage) &&
    storage.persistence === "session");

export const reminderSnoozeOperationIdentity = (
  storage: typeof ReminderSnoozeStorage.Type | undefined
): Option.Option<string> =>
  Match.value(storage).pipe(
    Match.when(ReminderSnoozeStorage.guards.Sampling, (operation) =>
      Option.some(operation.identity)
    ),
    Match.when(ReminderSnoozeStorage.guards.Saving, (operation) =>
      Option.some(operation.entry.identity)
    ),
    Match.orElse(() => Option.none())
  );

export const ReminderCard = Schema.Struct({
  kind: Schema.Literals(["upcoming", "reminder"]),
  snoozedUntil: Schema.optional(Schema.Finite),
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
  snoozeStorage: Schema.optional(ReminderSnoozeStorage),
  snoozes: Schema.optional(Schema.Array(ReminderSnooze)),
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
  snoozeRangeReady: Schema.optional(Schema.Boolean),
  webCards: Schema.optional(Schema.Boolean),
});
