import { ConferencingDefault } from "@calendar/calendar/contracts";
import { Effect, Option, Predicate, Schema } from "effect";
import { RpcClient } from "effect/rpc";
import { Command } from "foldkit";

import { Message } from "../message.js";
import { browserGroup, protocol } from "../rpc.js";
import { ConferencingChange } from "./model.js";
import type { ConferencingProblem } from "./model.js";

const requestFields = {
  accountId: Schema.NonEmptyString,
  personId: Schema.String,
  requestId: Schema.Int,
};

const FailureTag = Schema.Struct({ _tag: Schema.String });

const decodeConferencingProblem = (
  cause: unknown,
  operation: "read" | "write"
): typeof ConferencingProblem.Type => {
  const tag = Schema.decodeUnknownOption(FailureTag)(cause);

  if (Option.isSome(tag) && Predicate.isTagged(tag.value, "AccountNotOwned")) {
    return {
      message: "This account is no longer connected. Refresh the account list.",
    };
  }

  return {
    message:
      operation === "read"
        ? "Could not load this account's conferencing preference. Reload to try again."
        : "Could not confirm the change. Reload the preference before trying again.",
  };
};

export const ReadConferencingDefault = Command.define(
  "ReadConferencingDefault",
  {
    args: requestFields,
    execute: ({ accountId, personId, requestId }) =>
      Effect.gen(function* readConferencingDefault() {
        const client = yield* RpcClient.make(browserGroup);

        return yield* client.getAccountConferencingDefault({ accountId });
      }).pipe(
        Effect.provide(protocol),
        Effect.scoped,
        Effect.match({
          onFailure: (error) =>
            Message.ChangedConferencing({
              change: ConferencingChange.cases.Failed.make({
                accountId,
                personId,
                problem: decodeConferencingProblem(error, "read"),
                requestId,
              }),
            }),
          onSuccess: (result) =>
            Message.ChangedConferencing({
              change: ConferencingChange.cases.Received.make({
                accountId,
                personId,
                requestId,
                result,
              }),
            }),
        })
      ),
    messages: [Message.ChangedConferencing],
  }
);

export const WriteConferencingDefault = Command.define(
  "WriteConferencingDefault",
  {
    args: { ...requestFields, value: ConferencingDefault },
    execute: ({ accountId, personId, requestId, value }) =>
      Effect.gen(function* writeConferencingDefault() {
        const client = yield* RpcClient.make(browserGroup);

        return yield* client.setAccountConferencingDefault({
          accountId,
          value,
        });
      }).pipe(
        Effect.provide(protocol),
        Effect.scoped,
        Effect.match({
          onFailure: (error) =>
            Message.ChangedConferencing({
              change: ConferencingChange.cases.Failed.make({
                accountId,
                personId,
                problem: decodeConferencingProblem(error, "write"),
                requestId,
              }),
            }),
          onSuccess: (result) =>
            Message.ChangedConferencing({
              change: ConferencingChange.cases.Received.make({
                accountId,
                personId,
                requestId,
                result,
              }),
            }),
        })
      ),
    messages: [Message.ChangedConferencing],
  }
);
