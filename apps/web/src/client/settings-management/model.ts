import {
  Calendar,
  CalendarRef,
  DisconnectAccountResult,
} from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";

export const ManagementProblem = Schema.Struct({
  kind: Schema.Literals(["lastAccount", "notOwned", "refused", "unconfirmed"]),
  message: Schema.String,
});

const Request = { personId: Schema.NonEmptyString, requestId: Schema.Int };

export const ColourTask = Schema.TaggedStruct("Colour", {
  ...CalendarRef.fields,
  ...Request,
  colorId: Schema.NonEmptyString,
});

export const RemovalTask = Schema.TaggedStruct("Remove", {
  ...Request,
  accountId: Schema.NonEmptyString,
});

export const ManagementTask = Schema.Union([ColourTask, RemovalTask]);

export const ManagementValue = Schema.TaggedUnion({
  Colour: { calendar: Calendar },
  Removed: { result: DisconnectAccountResult },
});

export const ManagementOutcome = Schema.TaggedUnion({
  Failed: { problem: ManagementProblem, task: ManagementTask },
  Succeeded: { task: ManagementTask, value: ManagementValue },
});

export const RemovalState = Schema.TaggedUnion({
  Closed: {},
  Confirming: { accountId: Schema.String },
  Failed: { accountId: Schema.String, problem: ManagementProblem },
  Removed: { result: DisconnectAccountResult },
  Working: { task: RemovalTask },
});

export const ColourProblem = Schema.Struct({
  ...CalendarRef.fields,
  problem: ManagementProblem,
});

export const SettingsManagement = Schema.Struct({
  colourProblems: Schema.Array(ColourProblem),
  colours: Schema.Array(ColourTask),
  picker: Schema.Option(CalendarRef),
  removal: RemovalState,
  removedAccounts: Schema.Array(Schema.String),
  sequence: Schema.Int,
});

export type SettingsManagementValue = typeof SettingsManagement.Type;

export const initialSettingsManagement = (
  sequence = 0
): SettingsManagementValue => ({
  colourProblems: [],
  colours: [],
  picker: Option.none(),
  removal: RemovalState.cases.Closed.make({}),
  removedAccounts: [],
  sequence,
});

export const ManagementChange = Schema.TaggedUnion({
  CancelRemoval: {},
  ChooseColour: { ...CalendarRef.fields, colorId: Schema.String },
  ClosePicker: { ref: Schema.optionalKey(CalendarRef) },
  ConfirmRemoval: { accountId: Schema.String },
  OpenPicker: CalendarRef.fields,
  Remove: { accountId: Schema.String },
  Settled: { outcome: ManagementOutcome },
});
