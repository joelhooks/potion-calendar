import { AccountDeletionUnavailable } from "@calendar/core/contracts";
import { Context, Effect } from "effect";
import { RpcClient } from "effect/rpc";

import { browserGroup, protocol } from "../../rpc.js";

export interface AccountDeletionPortService {
  readonly remove: (
    proof: string
  ) => Effect.Effect<void, AccountDeletionUnavailable>;
}

const browserDeletion = (): AccountDeletionPortService => ({
  remove: Effect.fn("AccountDeletion.remove")(
    function* remove(proof: string) {
      const client = yield* RpcClient.make(browserGroup);
      yield* client.deleteAccount({
        confirmation: "permanently-delete-my-account",
        proof,
      });
    },
    Effect.provide(protocol),
    Effect.scoped,
    Effect.catchCause(() => Effect.fail(new AccountDeletionUnavailable()))
  ),
});

export const AccountDeletionPort =
  Context.Reference<AccountDeletionPortService>(
    "@calendar/web/AccountDeletionPort",
    { defaultValue: browserDeletion }
  );
