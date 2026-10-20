import type {
  ConnectedGoogleAccount,
  GoogleTokensError,
} from "@calendar/auth/google-tokens";
import { Match } from "effect";

import { NotConnected, Provider, Revoked } from "./errors.js";

export {
  ConnectedGoogleAccount as GoogleAccount,
  GoogleTokens,
} from "@calendar/auth/google-tokens";

export type GoogleAccountValue = typeof ConnectedGoogleAccount.Type;

export const tokenFailure = (error: GoogleTokensError) =>
  Match.value(error.reason).pipe(
    Match.when(
      "unavailable",
      () => new NotConnected({ accountId: error.accountId })
    ),
    Match.when(
      "disconnected",
      () => new Revoked({ accountId: error.accountId })
    ),
    Match.whenOr(
      "provider",
      "storage",
      (reason) =>
        new Provider({
          message:
            "Google account token could not be loaded; retry or reconnect the account",
          operation: `token.${reason}`,
          status: 0,
        })
    ),
    Match.exhaustive
  );
