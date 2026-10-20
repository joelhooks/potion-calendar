import { Option } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../app.js";
import type { EditorConferencingContext } from "../editing/conferencing-draft.js";

export const editorConferencingContext = (
  model: AppModel
): typeof EditorConferencingContext.Type => {
  const snapshot = Option.getOrUndefined(AsyncData.getData(model.session));

  if (
    snapshot === undefined ||
    snapshot === null ||
    Option.getOrUndefined(model.person) !== snapshot.user.id
  ) {
    return { accounts: [] };
  }

  return {
    accounts: snapshot.accounts.map((account) => {
      const state = Object.hasOwn(model.conferencing.accounts, account.id)
        ? model.conferencing.accounts[account.id]
        : undefined;

      const remote = state?.remote;

      const setting =
        !account.disconnected &&
        remote !== undefined &&
        AsyncData.isSuccess(remote) &&
        remote.data.accountId === account.id
          ? remote.data.value
          : undefined;

      return { accountId: account.id, email: account.email, setting };
    }),
  };
};
