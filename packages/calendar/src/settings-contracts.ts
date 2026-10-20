import { defineContract } from "@calendar/capability/contract";
import { Schema } from "effect";

import { AccountNotOwned } from "./account-not-owned.js";
import { CalendarAppearanceRefused } from "./calendar-appearance-refused.js";
import { CalendarFailure, NotConnected, Provider, Revoked } from "./errors.js";
import { LastCalendarAccount } from "./last-calendar-account.js";
import { Calendar, CalendarRef } from "./model.js";

export const DisconnectAccountInput = Schema.Struct({
  accountId: Schema.NonEmptyString,
});

export const disconnectAccountInstruction =
  "Potion Calendar has forgotten this account. To remove its Google access entirely, use your Google Account's third-party access page.";

export const DisconnectAccountResult = Schema.Struct({
  accountId: Schema.NonEmptyString,
  disconnected: Schema.Literal(true),
  instruction: Schema.Literal(disconnectAccountInstruction),
  revocation: Schema.Literal("notAttempted"),
});

export const DisconnectAccountFailure = Schema.Union([
  AccountNotOwned,
  LastCalendarAccount,
  NotConnected,
  Provider,
  Revoked,
]);

export const CalendarAppearancePatch = Schema.Struct({
  colorId: Schema.optionalKey(Schema.NonEmptyString),
  hidden: Schema.optionalKey(Schema.Boolean),
  selected: Schema.optionalKey(Schema.Boolean),
});

export const SetCalendarAppearanceInput = Schema.Struct({
  ...CalendarRef.fields,
  ...CalendarAppearancePatch.fields,
});

export const SetCalendarAppearanceFailure = Schema.Union([
  CalendarFailure,
  CalendarAppearanceRefused,
]);

export const disconnectAccountContract = defineContract("disconnectAccount", {
  annotations: { destructive: true, idempotent: true, readOnly: false },
  description:
    "Disconnect an owned non-final Google account and report best-effort grant revocation",
  failure: DisconnectAccountFailure,
  input: DisconnectAccountInput,
  output: DisconnectAccountResult,
});

export const setCalendarAppearanceContract = defineContract(
  "setCalendarAppearance",
  {
    annotations: { idempotent: true, readOnly: false },
    description:
      "Patch an owned Google calendarList entry using calendar-palette colours and provider visibility",
    failure: SetCalendarAppearanceFailure,
    input: SetCalendarAppearanceInput,
    output: Calendar,
  }
);
