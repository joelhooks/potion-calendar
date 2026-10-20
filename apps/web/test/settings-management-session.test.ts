import {
  DisconnectAccountResult,
  disconnectAccountInstruction,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import {
  ManagementChange,
  ManagementOutcome,
  ManagementValue,
  RemovalState,
} from "../src/client/settings-management/model.js";
import { fixtureModel } from "./fixture.js";

const remove = (model: AppModel): AppModel => {
  const confirming = update(
    model,
    Message.ChangedSettingsManagement({
      change: ManagementChange.cases.Remove.make({ accountId: "work" }),
    })
  ).model;

  return update(
    confirming,
    Message.ChangedSettingsManagement({
      change: ManagementChange.cases.ConfirmRemoval.make({ accountId: "work" }),
    })
  ).model;
};

it.effect(
  "same-person session refresh preserves an in-flight removal, while a different-person round trip cannot reuse its request number",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();

      const snapshot = Option.getOrThrow(
        AsyncData.getData(base.session).pipe(
          Option.flatMap(Option.fromNullishOr)
        )
      );

      const pending = remove(base);

      if (!RemovalState.guards.Working(pending.settingsManagement.removal)) {
        throw new Error("Expected pending request");
      }

      const old = pending.settingsManagement.removal.task;

      const refreshed = update(
        pending,
        Message.ReceivedSession({ snapshot })
      ).model;

      expect(refreshed.settingsManagement).toEqual(pending.settingsManagement);

      const other = update(
        pending,
        Message.ReceivedSession({
          snapshot: {
            ...snapshot,
            user: { ...snapshot.user, id: "other-person" },
          },
        })
      ).model;

      const returned = update(
        other,
        Message.ReceivedSession({ snapshot })
      ).model;

      const current = remove(returned);

      if (!RemovalState.guards.Working(current.settingsManagement.removal)) {
        throw new Error("Expected a new removal request");
      }

      expect(current.settingsManagement.removal.task.requestId).toBeGreaterThan(
        old.requestId
      );

      const result = DisconnectAccountResult.make({
        accountId: "work",
        disconnected: true,
        instruction: disconnectAccountInstruction,
        revocation: "notAttempted",
      });

      const ignored = update(
        current,
        Message.ChangedSettingsManagement({
          change: ManagementChange.cases.Settled.make({
            outcome: ManagementOutcome.cases.Succeeded.make({
              task: old,
              value: ManagementValue.cases.Removed.make({ result }),
            }),
          }),
        })
      );

      expect(ignored.model.settingsManagement.removal).toEqual(
        current.settingsManagement.removal
      );
      expect(ignored.model.settingsManagement.removedAccounts).toEqual([]);
      expect(ignored.commands ?? []).toHaveLength(0);
    })
);
