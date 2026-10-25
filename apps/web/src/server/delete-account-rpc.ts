import {
  allowedEmail,
  verifyAccountDeletionProof,
} from "@calendar/auth/google";
import type { GoogleAuth, GoogleAuthConfig } from "@calendar/auth/google";
import {
  AccountDeletionRefused,
  AccountDeletionUnavailable,
} from "@calendar/core/contracts";
import { Effect } from "effect";

import type { CalendarBackendOptions } from "./calendar-runtime.js";

const unavailable = () => new AccountDeletionUnavailable();

export const deleteCurrentAccount = Effect.fn("deleteCurrentAccount")(
  function* deleteCurrentAccount(
    auth: GoogleAuth,
    config: GoogleAuthConfig,
    headers: Headers,
    proof: string,
    operation: CalendarBackendOptions["deleteAccount"],
    committedCookies: Headers
  ) {
    const current = yield* Effect.tryPromise({
      catch: unavailable,
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        auth.api.getSession({
          headers,
          query: { disableCookieCache: true, disableRefresh: true },
        }),
    });

    if (
      current === null ||
      !current.user.emailVerified ||
      !allowedEmail(current.user.email, config.allowedEmails)
    ) {
      committedCookies.set("x-calendar-deletion-status", "409");

      return yield* new AccountDeletionRefused();
    }

    const confirmed = yield* verifyAccountDeletionProof(
      config.secret,
      current.session.token,
      proof
    ).pipe(Effect.mapError(unavailable));

    if (!confirmed) {
      committedCookies.set("x-calendar-deletion-status", "409");

      return yield* new AccountDeletionRefused();
    }

    if (operation === undefined) {
      return yield* unavailable();
    }

    yield* operation(current.user.id).pipe(Effect.mapError(unavailable));
    yield* Effect.gen(function* clearCommittedSessionCookie() {
      const response = yield* Effect.tryPromise({
        catch: unavailable,
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => auth.api.signOut({ asResponse: true, headers }),
      });

      yield* Effect.sync(() => {
        for (const cookie of response.headers.getSetCookie()) {
          committedCookies.append("set-cookie", cookie);
        }
      });
    }).pipe(
      Effect.catchCause(() =>
        Effect.logWarning(
          "Deleted account session-cookie cleanup did not complete"
        )
      )
    );

    return { deleted: true } as const;
  }
);
