import {
  Calendar,
  ListCalendarsOutput,
  ListEventsOutput,
} from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { NavigationState } from "../layout/navigation.js";
import {
  VisibilityChoices,
  VisibilityMigration,
} from "./settings/visibility-model.js";

export const ReadFailure = Schema.Struct({
  kind: Schema.Literals(["reconnect", "retry"]),
  message: Schema.String,
});

const FailureTag = Schema.Struct({ _tag: Schema.String });

const FailureCause = Schema.Struct({ cause: Schema.Unknown });

export const readFailure = (cause: unknown): typeof ReadFailure.Type => {
  const nested = Schema.decodeUnknownOption(FailureCause)(cause);

  const decoded = Schema.decodeUnknownOption(FailureTag)(
    Option.isSome(nested) ? nested.value.cause : cause
  );

  const reconnect =
    Option.isSome(decoded) &&
    ["Revoked", "NotConnected"].includes(decoded.value._tag);

  return reconnect
    ? {
        kind: "reconnect",
        message: "Reconnect this Google account to load its calendars.",
      }
    : {
        kind: "retry",
        message: "Google Calendar could not be loaded. Try again.",
      };
};

export const RemoteCalendars = AsyncData.Schema(
  ListCalendarsOutput,
  ReadFailure
);

export const RemoteEvents = AsyncData.Schema(ListEventsOutput, ReadFailure);

export const AccountEvents = Schema.Struct({
  accountId: Schema.String,
  events: RemoteEvents.schema,
});

export const CalendarUi = Schema.Struct({
  allDayExpanded: Schema.Boolean,
  allDayRows: Schema.Record(Schema.String, Schema.Int),
  calendars: Schema.Array(Calendar),
  hidden: Schema.Array(Schema.String),
  hideDeclined: Schema.Boolean,
  index: RemoteCalendars.schema,
  mergeDuplicates: Schema.Boolean,
  navigation: NavigationState,
  now: Schema.Finite,
  rangeRequest: Schema.Int,
  reads: Schema.Array(AccountEvents),
  scrollbarGutter: Schema.Finite,
  selected: Schema.Option(Schema.String),
  viewport: Schema.Finite,
  viewportWidth: Schema.Finite,
  visibility: VisibilityChoices,
  visibilityMigration: VisibilityMigration,
  zone: Schema.String,
  zoom: Schema.Int,
});

export const Preferences = Schema.Struct({
  hidden: Schema.Array(Schema.String),
  mergeDuplicates: Schema.optionalKey(Schema.Boolean),
});

export const calendarKey = (accountId: string, calendarId: string): string =>
  JSON.stringify([accountId, calendarId]);

export const eventKey = (event: {
  readonly accountId: string;
  readonly calendarId: string;
  readonly eventId: string;
}): string =>
  JSON.stringify([event.accountId, event.calendarId, event.eventId]);
