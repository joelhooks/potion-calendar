import { Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import {
  AccountDeletionChange,
  AccountDeletionReply,
} from "../src/client/settings/delete-account/model.js";
import { profileFixture, profileSnapshot } from "./profile-fixture.js";

export const otherDeleteSession = (model: AppModel) => {
  const snapshot = profileSnapshot(model);

  return {
    ...snapshot,
    accountDeletionProof: "b".repeat(64),
    accounts: snapshot.accounts.map((account, index) => ({
      ...account,
      email: `other-${index}@example.test`,
      id: `other-${account.id}`,
    })),
    user: {
      email: "other@example.test",
      id: "other-person",
      name: "Other Person",
    },
  };
};

export const changeDeletion = (
  model: AppModel,
  change: typeof AccountDeletionChange.Type,
  personId = Option.getOrElse(model.person, () => "")
) => update(model, Message.ChangedAccountDeletion({ change, personId }));

export const completeDeletion = (
  model: AppModel,
  reply: typeof AccountDeletionReply.Type,
  personId: string,
  sequence: number
) =>
  update(
    model,
    Message.AccountDeletionCompleted({ personId, reply, sequence })
  );

export const deleteAccountFixture = (
  scene:
    | "section"
    | "confirming"
    | "deleting"
    | "failure"
    | "deleted" = "section",
  width = 900,
  theme: AppModel["settings"]["theme"] = "light"
): AppModel => {
  const profile = profileFixture("pristine", width, theme);

  const snapshot = {
    ...profileSnapshot(profile),
    accountDeletionProof: "a".repeat(64),
  };

  const initial = {
    ...profile,
    session: AsyncData.Success({ data: snapshot }),
  };

  if (scene === "section") {
    return initial;
  }

  const opened = changeDeletion(
    initial,
    AccountDeletionChange.cases.Open.make({})
  ).model;

  if (scene === "confirming") {
    return opened;
  }

  const deleting = changeDeletion(
    opened,
    AccountDeletionChange.cases.Confirm.make({})
  ).model;

  if (scene === "deleting") {
    return deleting;
  }

  return completeDeletion(
    deleting,
    scene === "failure"
      ? AccountDeletionReply.cases.Failed.make({})
      : AccountDeletionReply.cases.Deleted.make({}),
    Option.getOrThrow(deleting.person),
    deleting.accountDeletion.sequence
  ).model;
};
