import {
  AccountConferencingDefault,
  ConferencingDefault,
  ConferencingStatus,
  EventRef,
} from "@calendar/calendar/contracts";
import { Schema } from "effect";
import { AsyncData } from "foldkit";

export const ConferencingSaveNotice = Schema.Struct({
  ...EventRef.fields,
  status: ConferencingStatus,
});

export const ConferencingProblem = Schema.Struct({ message: Schema.String });

export const RemoteConferencingDefault = AsyncData.Schema(
  AccountConferencingDefault,
  ConferencingProblem
);

export const AccountConferencingState = Schema.Struct({
  operation: Schema.Literals(["read", "write"]),
  remote: RemoteConferencingDefault.schema,
  requestId: Schema.Int,
});

export const ConferencingState = Schema.Struct({
  accounts: Schema.Record(Schema.String, AccountConferencingState),
  nextRequestId: Schema.Int,
});

export const initialConferencing = (): typeof ConferencingState.Type => ({
  accounts: {},
  nextRequestId: 0,
});

export const clearConferencing = (
  state: typeof ConferencingState.Type
): typeof ConferencingState.Type => ({
  accounts: {},
  nextRequestId: state.nextRequestId,
});

export const ConferencingChange = Schema.TaggedUnion({
  Failed: {
    accountId: Schema.String,
    personId: Schema.String,
    problem: ConferencingProblem,
    requestId: Schema.Int,
  },
  Load: { accountId: Schema.NonEmptyString, refresh: Schema.Boolean },
  Received: {
    accountId: Schema.String,
    personId: Schema.String,
    requestId: Schema.Int,
    result: AccountConferencingDefault,
  },
  Set: { accountId: Schema.NonEmptyString, value: ConferencingDefault },
});
