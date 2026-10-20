import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Command, Update } from "foldkit";

import type { AppModel } from "../app.js";
import type { AppMessage } from "../message.js";
import {
  ReadConferencingDefault,
  WriteConferencingDefault,
} from "./commands.js";
import { ConferencingChange, RemoteConferencingDefault } from "./model.js";
import type { AccountConferencingState, ConferencingProblem } from "./model.js";

type ConferencingUpdate = Update.Return<AppModel, AppMessage>;

type RemoteDefault = typeof RemoteConferencingDefault.schema.Type;

const stateFor = (
  model: AppModel,
  accountId: string
): typeof AccountConferencingState.Type | undefined =>
  Object.hasOwn(model.conferencing.accounts, accountId)
    ? model.conferencing.accounts[accountId]
    : undefined;

const pending = (remote: RemoteDefault): RemoteDefault => {
  const data = AsyncData.getData(remote);

  return Option.isSome(data)
    ? RemoteConferencingDefault.Refreshing({ data: data.value })
    : RemoteConferencingDefault.Loading();
};

const failed = (
  remote: RemoteDefault,
  problem: typeof ConferencingProblem.Type
): RemoteDefault => {
  const data = AsyncData.getData(remote);

  return Option.isSome(data)
    ? RemoteConferencingDefault.Stale({ data: data.value, error: problem })
    : RemoteConferencingDefault.Failure({ error: problem });
};

const begin = (
  model: AppModel,
  accountId: string,
  operation: "read" | "write"
): AppModel => {
  const current = stateFor(model, accountId);
  const requestId = model.conferencing.nextRequestId + 1;

  return {
    ...model,
    conferencing: {
      accounts: {
        ...model.conferencing.accounts,
        [accountId]: {
          operation,
          remote: pending(current?.remote ?? RemoteConferencingDefault.Idle()),
          requestId,
        },
      },
      nextRequestId: requestId,
    },
  };
};

const settle = (
  model: AppModel,
  accountId: string,
  remote: RemoteDefault
): AppModel => {
  const current = stateFor(model, accountId);

  if (current === undefined) {
    return model;
  }

  return {
    ...model,
    conferencing: {
      ...model.conferencing,
      accounts: {
        ...model.conferencing.accounts,
        [accountId]: { ...current, remote },
      },
    },
  };
};

export const changeConferencing = (
  model: AppModel,
  change: typeof ConferencingChange.Type
): ConferencingUpdate => {
  const personId = Option.getOrUndefined(model.person);

  if (personId === undefined) {
    return { model };
  }

  return ConferencingChange.match<ConferencingUpdate>(change, {
    Failed: (result) => {
      const current = stateFor(model, result.accountId);

      return result.personId !== personId ||
        current?.requestId !== result.requestId
        ? { model }
        : {
            model: settle(
              model,
              result.accountId,
              failed(current.remote, result.problem)
            ),
          };
    },
    Load: ({ accountId, refresh }) => {
      const current = stateFor(model, accountId);

      if (
        current !== undefined &&
        ((current.operation === "write" &&
          AsyncData.isPending(current.remote)) ||
          (!refresh &&
            (AsyncData.hasData(current.remote) ||
              AsyncData.isPending(current.remote))))
      ) {
        return { model };
      }

      const next = begin(model, accountId, "read");

      return {
        commands: [
          ReadConferencingDefault({
            accountId,
            personId,
            requestId: next.conferencing.nextRequestId,
          }),
        ],
        model: next,
      };
    },
    Received: (result) => {
      const current = stateFor(model, result.accountId);

      if (
        result.personId !== personId ||
        current?.requestId !== result.requestId
      ) {
        return { model };
      }

      const remote =
        result.result.accountId === result.accountId
          ? RemoteConferencingDefault.Success({ data: result.result })
          : failed(current.remote, {
              message:
                "The account preference could not be confirmed. Reload to try again.",
            });

      return { model: settle(model, result.accountId, remote) };
    },
    Set: ({ accountId, value }) => {
      const current = stateFor(model, accountId);

      if (
        current?.operation === "write" &&
        AsyncData.isPending(current.remote)
      ) {
        return { model };
      }

      const next = begin(model, accountId, "write");

      return {
        commands: [
          WriteConferencingDefault({
            accountId,
            personId,
            requestId: next.conferencing.nextRequestId,
            value,
          }),
        ],
        model: next,
      };
    },
  });
};

export const loadConferencingAccounts = (
  model: AppModel,
  accounts: readonly string[],
  refresh: boolean
): ConferencingUpdate => {
  const ids = new Set(accounts);

  let next: AppModel = {
    ...model,
    conferencing: {
      ...model.conferencing,
      accounts: Object.fromEntries(
        Object.entries(model.conferencing.accounts).filter(([id]) =>
          ids.has(id)
        )
      ),
    },
  };

  const commands: Command.Command<AppMessage>[] = [];

  for (const accountId of ids) {
    const result = changeConferencing(
      next,
      ConferencingChange.cases.Load.make({ accountId, refresh })
    );

    next = result.model;
    commands.push(...(result.commands ?? []));
  }

  return { commands, model: next };
};
