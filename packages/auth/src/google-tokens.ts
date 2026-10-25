import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { Clock, Context, DateTime, Effect, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { GoogleTokenAccount as StoredAccount } from "./google-token-account.js";
import type { TokenAccount } from "./google-token-account.js";
import { GoogleTokensError } from "./google-tokens-error.js";
import { allowedEmail, authContext } from "./google.js";
import type { GoogleAuth, GoogleAuthConfig } from "./google.js";
import { tokenAcquisition } from "./token-acquisition.js";

export { GoogleTokensError } from "./google-tokens-error.js";

export const ConnectedGoogleAccount = Schema.Struct({
  disconnected: Schema.Boolean,
  email: Schema.String,
  id: Schema.String,
});

export class GoogleTokens extends Context.Service<
  GoogleTokens,
  {
    readonly accounts: () => Effect.Effect<
      readonly (typeof ConnectedGoogleAccount.Type)[],
      GoogleTokensError
    >;
    readonly accessToken: (
      accountId: string,
      options?: { readonly forceRefresh?: boolean }
    ) => Effect.Effect<Redacted.Redacted, GoogleTokensError>;
  }
>()("@calendar/auth/GoogleTokens") {}

const RefreshedToken = Schema.Struct({
  access_token: Schema.NonEmptyString,
  expires_in: Schema.Finite.check(Schema.isGreaterThan(0)),
  refresh_token: Schema.optionalKey(Schema.NonEmptyString),
  token_type: Schema.String,
});

const ProviderError = Schema.Struct({ error: Schema.String });

const storageError = (accountId: string) =>
  new GoogleTokensError({ accountId, reason: "storage" });

const providerError = (accountId: string) =>
  new GoogleTokensError({ accountId, reason: "provider" });

const cachedOnlyRefresh = (account: TokenAccount) =>
  Effect.fail(
    new GoogleTokensError({ accountId: account.id, reason: "unavailable" })
  );

export const googleTokensFor = Effect.fn("googleTokensFor")(
  function* googleTokensFor(
    auth: GoogleAuth,
    userId: string,
    config: GoogleAuthConfig,
    tokenMode: "refresh" | "cached-only" = "refresh"
  ) {
    const context = yield* authContext(auth);
    const client = yield* HttpClient.HttpClient;

    const permittedEmails = config.allowedEmails.split(",").flatMap((value) => {
      const email = value.trim().toLowerCase();

      return email.length > 0 ? [email] : [];
    });

    const where = (id?: string) => [
      { field: "userId", value: userId },
      { field: "providerId", value: "google" },
      { field: "googleEmail", operator: "in" as const, value: permittedEmails },
      ...(id === undefined ? [] : [{ field: "id", value: id }]),
    ];

    const accounts = Effect.fn("GoogleTokens.accounts")(function* accounts() {
      const rows = yield* Effect.tryPromise({
        catch: () => storageError(""),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          context.adapter.findMany({
            limit: permittedEmails.length,
            model: "account",
            where: where(),
          }),
      });

      const decoded = yield* Schema.decodeUnknownEffect(
        Schema.Array(StoredAccount)
      )(rows).pipe(Effect.mapError(() => storageError("")));

      return decoded.map((row) => ({
        disconnected: row.disconnected,
        email: row.googleEmail,
        id: row.id,
      }));
    });

    const lookup = Effect.fn("GoogleTokens.lookup")(function* lookup(
      accountId: string,
      forceRefresh: boolean
    ) {
      const row = yield* Effect.tryPromise({
        catch: () => storageError(accountId),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          context.adapter.findOne({
            model: "account",
            where: where(accountId),
          }),
      });

      if (row === null) {
        return yield* new GoogleTokensError({
          accountId,
          reason: "unavailable",
        });
      }

      const account = yield* Schema.decodeUnknownEffect(StoredAccount)(
        row
      ).pipe(Effect.mapError(() => storageError(accountId)));

      if (account.disconnected) {
        return yield* new GoogleTokensError({
          accountId,
          reason: "disconnected",
        });
      }

      if (!allowedEmail(account.googleEmail, config.allowedEmails)) {
        return yield* new GoogleTokensError({
          accountId,
          reason: "unavailable",
        });
      }

      const now = yield* Clock.currentTimeMillis;

      return {
        account,
        useCached:
          !forceRefresh &&
          account.accessToken !== null &&
          account.accessTokenExpiresAt !== null &&
          account.accessTokenExpiresAt.getTime() > now,
      };
    });

    const cached = Effect.fn("GoogleTokens.cached")(function* cached(
      account: TokenAccount
    ) {
      const accountId = account.id;

      const token = yield* Effect.tryPromise({
        catch: () => storageError(accountId),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          symmetricDecrypt({
            data: account.accessToken ?? "",
            key: context.secretConfig,
          }),
      });

      return Redacted.make(token);
    });

    const refresh = Effect.fn("GoogleTokens.refresh")(function* refresh(
      account: TokenAccount
    ) {
      const accountId = account.id;
      const now = yield* Clock.currentTimeMillis;

      if (account.refreshToken === null) {
        return yield* new GoogleTokensError({
          accountId,
          reason: "unavailable",
        });
      }

      const refreshToken = yield* Effect.tryPromise({
        catch: () => storageError(accountId),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          symmetricDecrypt({
            data: account.refreshToken ?? "",
            key: context.secretConfig,
          }),
      });

      const response = yield* client
        .execute(
          HttpClientRequest.post(
            config.tokenEndpoint ?? "https://oauth2.googleapis.com/token"
          ).pipe(
            HttpClientRequest.bodyUrlParams({
              client_id: config.clientId,
              client_secret: config.clientSecret,
              grant_type: "refresh_token",
              refresh_token: refreshToken,
            })
          )
        )
        .pipe(Effect.mapError(() => providerError(accountId)));

      if (response.status !== 200) {
        const failure = yield* HttpClientResponse.schemaBodyJson(ProviderError)(
          response
        ).pipe(Effect.mapError(() => providerError(accountId)));

        if (failure.error === "invalid_grant") {
          yield* Effect.tryPromise({
            catch: () => storageError(accountId),

            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () =>
              context.adapter.update({
                model: "account",
                update: {
                  accessToken: null,
                  disconnected: true,
                  refreshToken: null,
                },
                where: where(accountId),
              }),
          });

          return yield* new GoogleTokensError({
            accountId,
            reason: "disconnected",
          });
        }

        return yield* providerError(accountId);
      }

      const tokens = yield* HttpClientResponse.schemaBodyJson(RefreshedToken)(
        response
      ).pipe(Effect.mapError(() => providerError(accountId)));

      const encrypted = yield* Effect.tryPromise({
        catch: () => storageError(accountId),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          symmetricEncrypt({
            data: tokens.access_token,
            key: context.secretConfig,
          }),
      });

      const rotated =
        tokens.refresh_token === undefined
          ? account.refreshToken
          : yield* Effect.tryPromise({
              catch: () => storageError(accountId),

              // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
              try: () =>
                symmetricEncrypt({
                  data: tokens.refresh_token ?? "",
                  key: context.secretConfig,
                }),
            });

      yield* Effect.tryPromise({
        catch: () => storageError(accountId),

        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          context.adapter.update({
            model: "account",
            update: {
              accessToken: encrypted,
              accessTokenExpiresAt: DateTime.toDateUtc(
                DateTime.makeUnsafe(now + tokens.expires_in * 1000)
              ),
              refreshToken: rotated,
            },
            where: where(accountId),
          }),
      });

      return Redacted.make(tokens.access_token);
    });

    const accessToken = tokenAcquisition({
      cached,
      lookup,
      refresh: tokenMode === "cached-only" ? cachedOnlyRefresh : refresh,
    });

    return GoogleTokens.of({ accessToken, accounts });
  }
);
