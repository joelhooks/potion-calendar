import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import {
  AccountDeletionChange,
  AccountDeletionReply,
} from "../src/client/settings/delete-account/model.js";
import {
  changeDeletion,
  completeDeletion,
  deleteAccountFixture,
  otherDeleteSession,
} from "./delete-account-fixture.js";
import { profileFixture, profileSnapshot } from "./profile-fixture.js";

const intents = {
  Cancel: AccountDeletionChange.cases.Cancel.make({}),
  Confirm: AccountDeletionChange.cases.Confirm.make({}),
  Open: AccountDeletionChange.cases.Open.make({}),
};

it.effect(
  "only an opened explicit confirmation admits one deletion command",
  () =>
    Effect.sync(() => {
      const initial = deleteAccountFixture();
      expect(changeDeletion(initial, intents.Confirm).commands ?? []).toEqual(
        []
      );
      const opened = changeDeletion(initial, intents.Open);
      expect(opened.model.accountDeletion.mode).toBe("confirming");
      expect(opened.commands ?? []).toEqual([]);
      const cancelled = changeDeletion(opened.model, intents.Cancel);
      expect(cancelled.model.accountDeletion.mode).toBe("closed");
      expect(cancelled.commands ?? []).toEqual([]);

      const confirmed = changeDeletion(
        changeDeletion(cancelled.model, intents.Open).model,
        intents.Confirm
      );

      const commands =
        confirmed.commands?.filter(
          (command) => command.name === "RunAccountDeletion"
        ) ?? [];

      expect(commands).toHaveLength(1);
      expect(commands[0]?.args).toEqual({
        personId: Option.getOrThrow(initial.person),
        proof: profileSnapshot(initial).accountDeletionProof,
        sequence: confirmed.model.accountDeletion.sequence,
      });
    })
);

it.effect.each(["saving", "discard"] as const)(
  "Profile %s or a missing server proof cannot open deletion",
  (scene) =>
    Effect.sync(() => {
      const initial = deleteAccountFixture();
      const blocked = { ...initial, profile: profileFixture(scene).profile };
      expect(
        changeDeletion(blocked, intents.Open).model.accountDeletion.mode
      ).toBe("closed");
      const missing = profileFixture();
      expect(
        changeDeletion(missing, intents.Open).model.accountDeletion.mode
      ).toBe("closed");
      expect(
        changeDeletion(initial, intents.Open, "another-person").model
      ).toEqual(initial);
    })
);

it.effect.prop(
  "an admitted deletion ignores generated duplicate clicks and cancellation until its matching reply",
  {
    failed: Schema.Boolean,
    history: Schema.Array(Schema.Literals(["Cancel", "Confirm", "Open"])).check(
      Schema.isMaxLength(40)
    ),
  },
  ({ history, failed }) =>
    Effect.sync(() => {
      let model = deleteAccountFixture("deleting");
      const original = model.accountDeletion;
      const person = Option.getOrThrow(model.person);
      const snapshot = profileSnapshot(model);

      for (const intent of ["Confirm", "Cancel", ...history] as const) {
        const result = changeDeletion(model, intents[intent]);
        expect(result.commands ?? []).toEqual([]);
        expect(result.model.accountDeletion).toEqual(original);
        ({ model } = result);
      }

      const finished = completeDeletion(
        model,
        failed
          ? AccountDeletionReply.cases.Failed.make({})
          : AccountDeletionReply.cases.Deleted.make({}),
        person,
        original.sequence
      );

      if (failed) {
        expect(finished.model.accountDeletion.mode).toBe("failed");
        expect(Option.isSome(finished.model.accountDeletion.error)).toBe(true);
        expect(profileSnapshot(finished.model)).toEqual(snapshot);
        expect(Option.contains(finished.model.person, person)).toBe(true);
        const retried = changeDeletion(finished.model, intents.Confirm);
        expect(
          retried.commands?.filter(
            (command) => command.name === "RunAccountDeletion"
          )
        ).toHaveLength(1);
        expect(retried.model.accountDeletion.sequence).toBeGreaterThan(
          original.sequence
        );
        expect(
          completeDeletion(
            retried.model,
            AccountDeletionReply.cases.Deleted.make({}),
            person,
            original.sequence
          ).model
        ).toEqual(retried.model);
      } else {
        expect(finished.model.accountDeletion.mode).toBe("deleted");
        expect(Option.isNone(finished.model.person)).toBe(true);
        expect(Option.isNone(finished.model.accountDeletion.proof)).toBe(true);
        expect(
          finished.commands?.some((command) => command.name === "NavigateRoute")
        ).toBe(true);
      }
    })
);

it.effect.prop(
  "generated stale sequence and foreign-person replies cannot change an admitted deletion",
  {
    history: Schema.Array(Schema.Literals(["stale", "foreign"])).check(
      Schema.isMaxLength(30)
    ),
  },
  ({ history }) =>
    Effect.sync(() => {
      const model = deleteAccountFixture("deleting");
      const person = Option.getOrThrow(model.person);

      for (const action of ["stale", "foreign", ...history] as const) {
        const result = completeDeletion(
          model,
          AccountDeletionReply.cases.Deleted.make({}),
          action === "foreign" ? "another-person" : person,
          action === "stale"
            ? model.accountDeletion.sequence - 1
            : model.accountDeletion.sequence
        );

        expect(result.model).toEqual(model);
        expect(result.commands ?? []).toEqual([]);
      }
    })
);

it.effect(
  "a B session clears A's intent, and even an old pending A receipt cannot sign B out",
  () =>
    Effect.sync(() => {
      const model = deleteAccountFixture("deleting");
      const first = Option.getOrThrow(model.person);
      const other = otherDeleteSession(model);

      const received = update(
        model,
        Message.ReceivedSession({ snapshot: other })
      ).model;

      expect(received.accountDeletion.mode).toBe("closed");
      expect(Option.isNone(received.accountDeletion.proof)).toBe(true);
      expect(received.accountDeletion.sequence).toBeGreaterThan(
        model.accountDeletion.sequence
      );
      expect(
        completeDeletion(
          received,
          AccountDeletionReply.cases.Deleted.make({}),
          first,
          model.accountDeletion.sequence
        ).model
      ).toEqual(received);

      const oldReceipt = {
        ...received,
        accountDeletion: model.accountDeletion,
      };

      const guarded = completeDeletion(
        oldReceipt,
        AccountDeletionReply.cases.Deleted.make({}),
        first,
        model.accountDeletion.sequence
      );

      expect(guarded.model).toEqual(oldReceipt);
      expect(profileSnapshot(guarded.model).user.id).toBe("other-person");
    })
);

it.effect(
  "an authenticated null notice during deletion retains the admitted receipt for the final success",
  () =>
    Effect.sync(() => {
      const model = deleteAccountFixture("deleting");
      const person = Option.getOrThrow(model.person);

      const cleared = update(
        model,
        Message.ReceivedSession({ snapshot: null })
      ).model;

      expect(Option.isNone(cleared.person)).toBe(true);
      expect(cleared.accountDeletion).toEqual(model.accountDeletion);

      const completed = completeDeletion(
        cleared,
        AccountDeletionReply.cases.Deleted.make({}),
        person,
        model.accountDeletion.sequence
      ).model;

      expect(completed.accountDeletion.mode).toBe("deleted");
      expect(
        Option.getOrThrow(AsyncData.getData(completed.session))
      ).toBeNull();
    })
);
