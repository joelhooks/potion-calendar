import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import type { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { Cause, Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import { desktopHandoff } from "./desktop.js";
import type { DesktopHandoffStore } from "./desktop.js";
import { profileUpdateHook } from "./profile.js";

export const googleScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
];

export interface GoogleAuthConfig {
  readonly baseURL: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly secret: string;
  readonly allowedEmails: string;
  readonly tokenEndpoint?: string;
  readonly desktopStore?: DesktopHandoffStore;
  readonly beforeAccountDelete?: (
    personId: string,
    accountId: string
  ) => Promise<void>;
}

export const GoogleProfile = Schema.Struct({
  email: Schema.String,
  email_verified: Schema.Boolean,
  name: Schema.String,
  sub: Schema.NonEmptyString,
});

export const allowedEmail = (email: string, allowlist: string) =>
  allowlist
    .split(",")
    .some(
      (allowed) =>
        allowed.trim().toLowerCase() === email.trim().toLowerCase() &&
        allowed.trim().length > 0
    );

export interface GoogleIdentity {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string;
}

export interface GoogleProvider {
  readonly oauth: Pick<
    GenericOAuthConfig,
    "authorizationUrl" | "tokenUrl" | "getToken"
  >;
  readonly userInfo: (accessToken: string) => Promise<GoogleIdentity>;
}

export const liveGoogle: GoogleProvider = {
  oauth: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Better Auth consumes a Promise; HTTP work stays in Effect.
  userInfo: async (accessToken) =>
    await Effect.runPromise(
      Effect.gen(function* googleUserInfo() {
        const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);

        const response = yield* client.get(
          "https://openidconnect.googleapis.com/v1/userinfo",
          {
            headers: { authorization: `Bearer ${accessToken}` },
          }
        );

        const profile =
          yield* HttpClientResponse.schemaBodyJson(GoogleProfile)(response);

        return {
          email: profile.email.toLowerCase(),
          emailVerified: profile.email_verified,
          id: profile.sub,
          name: profile.name,
        };
      }).pipe(Effect.provide(FetchHttpClient.layer))
    ),
};

export const googleAuthOptions = (
  config: GoogleAuthConfig,
  provider: GoogleProvider = liveGoogle
): BetterAuthOptions =>
  ({
    account: {
      accountLinking: {
        allowDifferentEmails: true,
        disableImplicitLinking: true,
        enabled: true,
      },
      additionalFields: {
        disconnected: { defaultValue: false, input: false, type: "boolean" },
        googleEmail: { input: false, required: false, type: "string" },
      },
      encryptOAuthTokens: true,
    },
    basePath: "/auth",
    baseURL: config.baseURL,
    databaseHooks: {
      account: {
        create: {
          // @effect-diagnostics-next-line asyncFunction:off -- Better Auth owns the transactional account hook.
          before: async (account, context) => {
            if (
              account.providerId !== "google" ||
              account.accessToken === null ||
              account.accessToken === undefined ||
              !context
            ) {
              return false;
            }

            const secret = context.context.secretConfig;

            const token = await symmetricDecrypt({
              data: account.accessToken,
              key: secret,
            });

            const profile = await provider.userInfo(token);

            if (
              !profile.emailVerified ||
              !allowedEmail(profile.email, config.allowedEmails) ||
              profile.id !== account.accountId
            ) {
              return false;
            }

            return {
              data: {
                ...account,
                disconnected: false,
                googleEmail: profile.email,
                idToken: null,
              },
            };
          },
        },
        delete: {
          // @effect-diagnostics-next-line asyncFunction:off -- Better Auth owns account deletion; cleanup is best-effort and cannot prevent unlinking.
          before: async (account) => {
            const cleanup = config.beforeAccountDelete;

            if (account.providerId === "google" && cleanup !== undefined) {
              await Effect.runPromise(
                Effect.tryPromise({
                  catch: (cause) =>
                    new Cause.UnknownError(
                      cause,
                      "Native Promise adapter failed"
                    ),

                  // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
                  try: () => cleanup(account.userId, account.id),
                }).pipe(
                  Effect.timeout("2 seconds"),
                  Effect.catch(() =>
                    Effect.logWarning(
                      "Google watch cleanup did not complete before account deletion"
                    )
                  )
                )
              );
            }
          },
        },
        update: {
          // @effect-diagnostics-next-line asyncFunction:off -- Better Auth owns the account update hook; ID tokens are not retained.
          before: async (account) => {
            const data =
              account.accessToken === null || account.accessToken === undefined
                ? { ...account, idToken: null }
                : { ...account, disconnected: false, idToken: null };

            return await Promise.resolve({ data });
          },
        },
      },
      user: {
        create: {
          // @effect-diagnostics-next-line asyncFunction:off -- Better Auth checks this before inserting a user.
          before: async (user) =>
            await Promise.resolve(
              allowedEmail(user.email, config.allowedEmails)
            ),
        },
      },
    },
    disabledPaths: [
      "/get-access-token",
      "/refresh-token",
      "/sign-in/social",
      "/unlink-account",
    ],
    hooks: { before: profileUpdateHook },
    onAPIError: { errorURL: `${config.baseURL}/refused` },
    plugins: [
      ...(config.desktopStore === undefined
        ? []
        : [
            desktopHandoff(config.desktopStore, (email) =>
              allowedEmail(email, config.allowedEmails)
            ),
          ]),
      genericOAuth({
        config: [
          {
            ...provider.oauth,
            accessType: "offline",
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            // @effect-diagnostics-next-line asyncFunction:off -- This provider gate runs before Better Auth's sign-in and linking writes.
            getUserInfo: async (tokens) => {
              if (tokens.accessToken === undefined) {
                return null;
              }

              const profile = await provider.userInfo(tokens.accessToken);

              return profile.emailVerified &&
                allowedEmail(profile.email, config.allowedEmails)
                ? profile
                : null;
            },
            pkce: true,
            prompt: "consent",
            providerId: "google",
            scopes: googleScopes,
          },
        ],
      }),
    ],
    secret: config.secret,
    trustedOrigins: [config.baseURL],
  }) satisfies BetterAuthOptions;

export const createGoogleAuth = (
  config: GoogleAuthConfig,
  database?: D1Database | ReturnType<typeof memoryAdapter>,
  provider: GoogleProvider = liveGoogle
): GoogleAuth => {
  const options = googleAuthOptions(config, provider);

  if (database !== undefined) {
    options.database = database;
  }

  return betterAuth(options);
};

export type GoogleAuth = ReturnType<typeof betterAuth>;

// @effect-diagnostics-next-line asyncFunction:off -- Better Auth exposes initialization as a Promise.
const initializeContext = async (auth: GoogleAuth) => await auth.$context;

export const authContext = (auth: GoogleAuth) =>
  Effect.promise(initializeContext.bind(undefined, auth));
