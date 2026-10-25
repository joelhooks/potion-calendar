import { Schema } from "effect";

export const ReminderNotificationAction = Schema.Literals([
  "show",
  "join",
  "email",
  "start",
]);

export const WorkerReceipt = Schema.Struct({
  channel: Schema.Literal("calendar-reminder-worker"),
  id: Schema.String,
  receipt: Schema.String,
  tag: Schema.String,
});

export const WorkerMessage = Schema.Struct({
  ...WorkerReceipt.fields,
  action: Schema.Union([ReminderNotificationAction, Schema.Literal("close")]),
});
