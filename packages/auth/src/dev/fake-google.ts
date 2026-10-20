import { memoryAdapter } from "better-auth/adapters/memory";
import { generateRandomString } from "better-auth/crypto";
import { DateTime, Schema } from "effect";

import { createGoogleAuth } from "../google.js";
import type {
  GoogleAuth,
  GoogleAuthConfig,
  GoogleIdentity,
  GoogleProvider,
} from "../google.js";

const Authorization = Schema.Struct({
  client_id: Schema.NonEmptyString,
  code_challenge: Schema.NonEmptyString,
  code_challenge_method: Schema.Literal("S256"),
  redirect_uri: Schema.String,
  state: Schema.NonEmptyString,
});

interface FakeRefresh {
  readonly access_token: string;
  readonly expires_in: number;
  readonly token_type: string;
}

export const makeFakeGoogle = (origin: string) => {
  const grants = new Map<
    string,
    {
      readonly challenge: string;
      readonly redirectURI: string;
      readonly email: string;
    }
  >();

  const identities = new Map<string, GoogleIdentity>();
  const refreshGrants = new Map<string, string>();

  const provider: GoogleProvider = {
    oauth: {
      authorizationUrl: `${origin}/__fake-google/authorize`,
      // @effect-diagnostics-next-line asyncFunction:off -- The development OAuth provider implements Better Auth's Promise interface.
      getToken: async ({ code, codeVerifier, redirectURI }) => {
        const grant = grants.get(code);
        grants.delete(code);

        if (
          !grant ||
          codeVerifier === undefined ||
          grant.redirectURI !== redirectURI
        ) {
          throw new Error("Fake Google rejected the authorization code");
        }

        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(codeVerifier)
        );

        const challenge = btoa(String.fromCodePoint(...new Uint8Array(digest)))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", "");

        if (challenge !== grant.challenge) {
          throw new Error("Fake Google rejected PKCE");
        }

        const token = `fake-google-access-${generateRandomString(32)}`;
        identities.set(token, {
          email: grant.email,
          emailVerified: true,
          id: grant.email,
          name: grant.email.split("@")[0] ?? "Local person",
        });

        const refreshToken = `fake-google-refresh-${generateRandomString(32)}`;
        refreshGrants.set(refreshToken, token);

        return {
          accessToken: token,
          accessTokenExpiresAt: DateTime.toDateUtc(
            DateTime.add(DateTime.nowUnsafe(), { hours: 1 })
          ),
          idToken: "fake-google-id-token-not-for-storage",
          refreshToken,
          scopes: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar",
          ],
        };
      },
      tokenUrl: `${origin}/__fake-google/token`,
    },
    // @effect-diagnostics-next-line asyncFunction:off -- The fake implements Better Auth's Promise userinfo interface.
    userInfo: async (token) => {
      const identity = identities.get(token);

      if (!identity) {
        throw new Error("Fake Google rejected the access token");
      }

      return await Promise.resolve(identity);
    },
  };

  const authorize = (url: URL, email: string) => {
    const input = Schema.decodeUnknownSync(Authorization)(
      Object.fromEntries(url.searchParams)
    );

    if (
      input.client_id !== "calendar-local" ||
      input.redirect_uri !== `${origin}/auth/oauth2/callback/google`
    ) {
      throw new Error("Fake Google rejected the client or callback");
    }

    const code = generateRandomString(32);
    grants.set(code, {
      challenge: input.code_challenge,
      email,
      redirectURI: input.redirect_uri,
    });
    const callback = new URL(input.redirect_uri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", input.state);

    return callback;
  };

  const refresh = (refreshToken: string): FakeRefresh | null => {
    const previous = refreshGrants.get(refreshToken);

    const identity =
      previous === undefined ? undefined : identities.get(previous);

    if (!identity) {
      return null;
    }

    const token = `fake-google-access-${generateRandomString(32)}`;
    identities.set(token, identity);
    refreshGrants.set(refreshToken, token);

    return { access_token: token, expires_in: 3600, token_type: "Bearer" };
  };

  return { authorize, provider, refresh };
};

interface FakeAuth {
  readonly auth: GoogleAuth;
  readonly config: GoogleAuthConfig;
  readonly provider: GoogleProvider;
  readonly authorize: (url: URL, email: string) => URL;
  readonly refresh: (refreshToken: string) => FakeRefresh | null;
}

export const createFakeAuth = (origin: string): FakeAuth => {
  const fake = makeFakeGoogle(origin);

  const config = {
    allowedEmails: "joel@example.test, second@example.test",
    baseURL: origin,
    clientId: "calendar-local",
    clientSecret: "local-only-client-secret",
    secret: "calendar-development-only-signing-key-not-for-production",
    tokenEndpoint: `${origin}/__fake-google/token`,
  };

  const auth = createGoogleAuth(
    config,
    memoryAdapter({ account: [], session: [], user: [], verification: [] }),
    fake.provider
  );

  return { ...fake, auth, config };
};
