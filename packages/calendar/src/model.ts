import { Schema } from "effect";

import { ConferencingStatus } from "./conferencing-model.js";
import { ConferenceDetails } from "./owned-conference.js";

export const CalendarRef = Schema.Struct({
  accountId: Schema.NonEmptyString,
  calendarId: Schema.NonEmptyString,
});

export type CalendarRefValue = typeof CalendarRef.Type;

export const EventRef = Schema.Struct({
  ...CalendarRef.fields,
  eventId: Schema.NonEmptyString,
});

export type EventRefValue = typeof EventRef.Type;

export const EventTime = Schema.Union([
  Schema.Struct({
    date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
  }),
  Schema.Struct({
    dateTime: Schema.String.check(
      Schema.isPattern(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u)
    ),
    timeZone: Schema.optional(Schema.String),
  }),
]);

export type EventTimeValue = typeof EventTime.Type;

export const ResponseStatus = Schema.Literals([
  "accepted",
  "declined",
  "tentative",
  "needsAction",
]);

export const Attendee = Schema.Struct({
  comment: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  email: Schema.String,
  optional: Schema.optional(Schema.Boolean),
  organizer: Schema.optional(Schema.Boolean),
  resource: Schema.optional(Schema.Boolean),
  responseStatus: Schema.optional(ResponseStatus),
  self: Schema.optional(Schema.Boolean),
});

export const Reminder = Schema.Struct({
  method: Schema.Literals(["email", "popup"]),
  minutes: Schema.Int.check(Schema.isBetween({ maximum: 40_320, minimum: 0 })),
});

export type ReminderValue = typeof Reminder.Type;

export const EventReminders = Schema.Struct({
  overrides: Schema.optional(Schema.Array(Reminder)),
  useDefault: Schema.Boolean,
});

export type EventRemindersValue = typeof EventReminders.Type;

export const EventAttachment = Schema.Struct({
  iconUrl: Schema.optional(Schema.String),
  mimeType: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  url: Schema.String,
});

export const StatusEventProperties = Schema.Struct({
  autoDeclineMode: Schema.optional(
    Schema.Literals([
      "declineNone",
      "declineAllConflictingInvitations",
      "declineOnlyNewConflictingInvitations",
    ])
  ),
  declineMessage: Schema.optional(Schema.String),
});

export const FocusTimeProperties = Schema.Struct({
  ...StatusEventProperties.fields,
  chatStatus: Schema.optional(Schema.Literals(["available", "doNotDisturb"])),
});

export const EventFields = Schema.Struct({
  attachments: Schema.optional(Schema.Array(EventAttachment)),
  attendees: Schema.optional(Schema.Array(Attendee)),
  attendeesOmitted: Schema.optional(Schema.Boolean),
  colorId: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.String),
  end: Schema.optional(EventTime),
  eventType: Schema.optional(
    Schema.Literals([
      "default",
      "focusTime",
      "outOfOffice",
      "workingLocation",
      "birthday",
      "fromGmail",
    ])
  ),
  focusTimeProperties: Schema.optional(FocusTimeProperties),
  guestsCanInviteOthers: Schema.optional(Schema.Boolean),
  guestsCanModify: Schema.optional(Schema.Boolean),
  guestsCanSeeOtherGuests: Schema.optional(Schema.Boolean),
  location: Schema.optional(Schema.String),
  outOfOfficeProperties: Schema.optional(StatusEventProperties),
  recurrence: Schema.optional(Schema.Array(Schema.String)),
  reminders: Schema.optional(EventReminders),
  start: Schema.optional(EventTime),
  title: Schema.optional(Schema.String),
  transparency: Schema.optional(Schema.Literals(["opaque", "transparent"])),
  visibility: Schema.optional(
    Schema.Literals(["default", "public", "private", "confidential"])
  ),
});

export type EventFieldsValue = typeof EventFields.Type;

export const CalendarEvent = Schema.Struct({
  ...EventRef.fields,
  ...EventFields.fields,
  conference: Schema.optional(ConferenceDetails),
  conferenceUrl: Schema.optional(Schema.String),
  conferencingStatus: Schema.optional(ConferencingStatus),
  creator: Schema.optional(
    Schema.Struct({
      displayName: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
      self: Schema.optional(Schema.Boolean),
    })
  ),
  etag: Schema.optional(Schema.String),
  htmlLink: Schema.optional(Schema.String),
  iCalUID: Schema.optional(Schema.String),
  organizer: Schema.optional(
    Schema.Struct({
      displayName: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
      self: Schema.optional(Schema.Boolean),
    })
  ),
  originalStartTime: Schema.optional(EventTime),
  recurringEventId: Schema.optional(Schema.String),
  status: Schema.Literals(["confirmed", "tentative", "cancelled"]),
});

export type CalendarEventValue = typeof CalendarEvent.Type;

export const Calendar = Schema.Struct({
  ...CalendarRef.fields,
  accessRole: Schema.Literals(["freeBusyReader", "reader", "writer", "owner"]),
  allowedConferenceSolutionTypes: Schema.optional(Schema.Array(Schema.String)),
  backgroundColor: Schema.optional(Schema.String),
  colorId: Schema.optional(Schema.String),
  defaultReminders: Schema.optional(Schema.Array(Reminder)),
  foregroundColor: Schema.optional(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
  primary: Schema.Boolean,
  selected: Schema.optional(Schema.Boolean),
  timeZone: Schema.String,
  title: Schema.String,
});

export type CalendarValue = typeof Calendar.Type;

export const Range = Schema.Struct({
  end: Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u)
  ),
  start: Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u)
  ),
});

export type RangeValue = typeof Range.Type;

export const EditScope = Schema.Literals(["single", "allFollowing", "all"]);

export const SendUpdates = Schema.Literals(["none", "all", "externalOnly"]);

export const ClientEventId = Schema.String.check(
  Schema.isPattern(/^[0-9a-v]{5,1024}$/u)
);

export const Colors = Schema.Struct({
  calendar: Schema.Record(
    Schema.String,
    Schema.Struct({ background: Schema.String, foreground: Schema.String })
  ),
  event: Schema.Record(
    Schema.String,
    Schema.Struct({ background: Schema.String, foreground: Schema.String })
  ),
});

export type ColorsValue = typeof Colors.Type;

export const WatchChannel = Schema.Struct({
  expiration: Schema.optional(Schema.String),
  id: Schema.String,
  resourceId: Schema.String,
});
