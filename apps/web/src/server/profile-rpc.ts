import { normalizeProfileName } from "@calendar/auth/contracts";
import { allowedEmail, verifyProfileUpdateProof } from "@calendar/auth/google";
import type { GoogleAuth, GoogleAuthConfig } from "@calendar/auth/google";
import {
  ProfileUpdateRefused,
  ProfileUpdateUnavailable,
} from "@calendar/core/contracts";
import type { SaveProfileInput } from "@calendar/core/contracts";
import { Effect, Option } from "effect";

import type { CalendarBackendOptions } from "./calendar-runtime.js";

export const saveCurrentProfile = Effect.fn("saveCurrentProfile")(
  function* saveCurrentProfile(
    auth: GoogleAuth,
    config: GoogleAuthConfig,
    headers: Headers,
    input: typeof SaveProfileInput.Type,
    operation: CalendarBackendOptions["saveProfile"]
  ) {
    const current = yield* Effect.tryPromise({
      catch: () => new ProfileUpdateUnavailable(),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        auth.api.getSession({
          headers,
          query: { disableCookieCache: true, disableRefresh: true },
        }),
    });

    const name = normalizeProfileName(input.name);

    if (
      current === null ||
      !current.user.emailVerified ||
      !allowedEmail(current.user.email, config.allowedEmails) ||
      Option.isNone(name)
    ) {
      return yield* new ProfileUpdateRefused();
    }

    const confirmed = yield* verifyProfileUpdateProof(
      config.secret,
      current.session.token,
      input.proof
    ).pipe(Effect.mapError(() => new ProfileUpdateUnavailable()));

    if (!confirmed) {
      return yield* new ProfileUpdateRefused();
    }

    if (operation === undefined) {
      return yield* new ProfileUpdateUnavailable();
    }

    const fields = {
      name: name.value,
      sessionId: current.session.id,
      sessionToken: current.session.token,
    };

    const write =
      input.primaryAccountId === undefined
        ? fields
        : { ...fields, primaryAccountId: input.primaryAccountId };

    const saved = yield* operation(current.user.id, write).pipe(
      Effect.mapError(() => new ProfileUpdateUnavailable())
    );

    if (saved === null) {
      return yield* new ProfileUpdateRefused();
    }

    return saved;
  }
);
