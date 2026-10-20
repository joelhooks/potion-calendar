// @effect-diagnostics-next-line nodeBuiltinImport:off -- This seam loads the checked-in SQLite migration.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { expect, it } from "@effect/vitest";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import {
  Cause,
  DateTime,
  Effect,
  Layer,
  Match,
  Redacted,
  Result,
  Schema,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { makeFakeGoogle } from "../src/dev/fake-google.js";
import { googleTokensFor } from "../src/google-tokens.js";
import {
  authContext,
  createGoogleAuth,
  googleAuthOptions,
} from "../src/google.js";

const config = {
  allowedEmails: "joel@example.test, second@example.test",
  baseURL: "http://calendar.test",
  clientId: "calendar-local",
  clientSecret: "local-only-client-secret",
  secret: "local-only-auth-secret-at-least-thirty-two-characters",
};

const UrlResponse = Schema.Struct({ url: Schema.String });

const StoredTokens = Schema.Struct({
  accessToken: Schema.String,
  googleEmail: Schema.String,
  id: Schema.String,
  idToken: Schema.NullOr(Schema.String),
  refreshToken: Schema.String,
  userId: Schema.String,
});

const cookies = (response: Response, existing = "") => {
  const jar = new Map(
    existing
      .split("; ")
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");

        return [entry.slice(0, separator), entry.slice(separator + 1)];
      })
  );

  for (const value of response.headers.getSetCookie()) {
    const entry = value.split(";")[0] ?? "";
    const separator = entry.indexOf("=");
    jar.set(entry.slice(0, separator), entry.slice(separator + 1));
  }

  return [...jar]
    .flatMap(([name, value]) => (value.length > 0 ? [`${name}=${value}`] : []))
    .join("; ");
};

const fixture = (
  sqlite?: DatabaseSync,
  cleanup?: (personId: string, accountId: string) => Promise<void>
) => {
  const authConfig =
    cleanup === undefined
      ? config
      : { ...config, beforeAccountDelete: cleanup };

  const fake = makeFakeGoogle(config.baseURL);

  const auth =
    sqlite === undefined
      ? createGoogleAuth(
          authConfig,
          memoryAdapter({
            account: [],
            session: [],
            user: [],
            verification: [],
          }),
          fake.provider
        )
      : betterAuth<BetterAuthOptions>({
          ...googleAuthOptions(authConfig, fake.provider),
          database: sqlite,
        });

  const authorize = Effect.fn("test.authorize")(function* authorize(
    email: string,
    cookie?: string,
    link?: boolean
  ) {
    const start = yield* Effect.promise(
      auth.handler.bind(
        auth,
        new Request(
          `${config.baseURL}/auth/${link === true ? "oauth2/link" : "sign-in/oauth2"}`,
          {
            body: JSON.stringify({
              callbackURL: "/",
              errorCallbackURL: "/refused",
              providerId: "google",
            }),
            headers: {
              "content-type": "application/json",
              cookie: cookie ?? "",
              origin: config.baseURL,
            },
            method: "POST",
          }
        )
      )
    );

    const startBody = yield* Effect.promise(
      start.clone().text.bind(start.clone())
    );

    expect(start.status, startBody).toBe(200);
    const document = yield* Effect.promise(start.json.bind(start));
    const location = yield* Schema.decodeUnknownEffect(UrlResponse)(document);
    const authorization = new URL(location.url);
    expect(authorization.searchParams.get("access_type")).toBe("offline");
    expect(authorization.searchParams.get("prompt")).toBe("consent");
    expect(authorization.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/calendar"
    );
    const callback = fake.authorize(authorization, email);

    const response = yield* Effect.promise(
      auth.handler.bind(
        auth,
        new Request(callback, {
          headers: { cookie: cookies(start, cookie) },
        })
      )
    );

    return { cookie: cookies(response, cookies(start, cookie)), response };
  });

  const unlink = (cookie: string, accountId: string) =>
    Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(cause, "Native Promise adapter failed"),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        auth.api.unlinkAccount({
          asResponse: true,
          body: { accountId, providerId: "google" },
          headers: new Headers({ cookie, origin: config.baseURL }),
        }),
    }).pipe(Effect.orDie);

  return { auth, authorize, unlink };
};

it.effect(
  "the alternate social sign-in endpoint cannot issue a Google authorization URL",
  () =>
    Effect.gen(function* disabledSocialSignIn() {
      const { auth } = fixture();

      for (const path of ["/auth/sign-in/social", "/auth/sign-in/social/"]) {
        const response = yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(
              cause,
              "Disabled OAuth endpoint request failed"
            ),
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () =>
            auth.handler(
              new Request(`${config.baseURL}${path}`, {
                body: JSON.stringify({ callbackURL: "/", provider: "google" }),
                headers: {
                  "content-type": "application/json",
                  origin: config.baseURL,
                },
                method: "POST",
              })
            ),
        });

        expect(response.status).toBe(404);
      }
    })
);

it.effect(
  "the authenticated Better Auth removal route cannot bypass the disconnect contract",
  () =>
    Effect.gen(function* refusedLegacyRemoval() {
      const { auth, authorize } = fixture();
      const signedIn = yield* authorize("joel@example.test");

      const linked = yield* authorize(
        "second@example.test",
        signedIn.cookie,
        true
      );

      for (const path of ["/auth/unlink-account", "/auth/unlink-account/"]) {
        const response = yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(
              cause,
              "Disabled account removal request failed"
            ),
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () =>
            auth.handler(
              new Request(`${config.baseURL}${path}`, {
                body: JSON.stringify({
                  accountId: "second@example.test",
                  providerId: "google",
                }),
                headers: {
                  "content-type": "application/json",
                  cookie: linked.cookie,
                  origin: config.baseURL,
                },
                method: "POST",
              })
            ),
        });

        expect(response.status).toBe(404);
      }

      const context = yield* authContext(auth);

      const accounts = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Account verification failed"),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => context.adapter.findMany({ model: "account" }),
      });

      expect(accounts).toHaveLength(2);
    })
);

for (const outcome of ["completed", "rejected", "timed-out"]) {
  it.live(
    `trusted Better Auth deletion keeps its bounded callback when ${outcome}`,
    () =>
      Effect.gen(function* bestEffortUnlink() {
        const observed: {
          readonly personId: string;
          readonly accountId: string;
        }[] = [];

        const { auth, authorize, unlink } = fixture(
          undefined,
          // @effect-diagnostics-next-line asyncFunction:off -- This fixture implements Better Auth's native cleanup callback, including a deliberately stalled Promise.
          async (personId, accountId) => {
            observed.push({ accountId, personId });

            if (outcome === "rejected") {
              throw new Error("Fixture cleanup unavailable");
            }

            if (outcome === "timed-out") {
              await Promise.race<undefined>([]);
            }
          }
        );

        const signedIn = yield* authorize("joel@example.test");
        expect(
          (yield* unlink(signedIn.cookie, "joel@example.test")).status
        ).toBe(400);
        expect(observed).toEqual([]);

        const linked = yield* authorize(
          "second@example.test",
          signedIn.cookie,
          true
        );

        const context = yield* authContext(auth);

        const before = yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Native Promise adapter failed"),

          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () =>
            context.adapter.findMany({
              model: "account",
              where: [{ field: "accountId", value: "second@example.test" }],
            }),
        }).pipe(Effect.orDie);

        const stored = yield* Schema.decodeUnknownEffect(
          Schema.NonEmptyArray(
            Schema.Struct({ id: Schema.String, userId: Schema.String })
          )
        )(before);

        expect(
          (yield* unlink(linked.cookie, "second@example.test")).status
        ).toBe(200);
        expect(observed).toEqual([
          { accountId: stored[0].id, personId: stored[0].userId },
        ]);
        expect(
          yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(cause, "Native Promise adapter failed"),

            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () =>
              context.adapter.findMany({
                model: "account",
                where: [{ field: "id", value: stored[0].id }],
              }),
          }).pipe(Effect.orDie)
        ).toHaveLength(0);
      })
  );
}

it.effect(
  "refuses an unlisted Google identity before inserting a user or account",
  () =>
    Effect.gen(function* testGoogleAuth() {
      const { auth, authorize } = fixture();
      const { response } = yield* authorize("outsider@example.test");
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toContain("/refused");
      const context = yield* authContext(auth);
      expect(
        yield* Effect.promise(
          context.adapter.findMany.bind(context.adapter, { model: "user" })
        )
      ).toHaveLength(0);
      expect(
        yield* Effect.promise(
          context.adapter.findMany.bind(context.adapter, { model: "account" })
        )
      ).toHaveLength(0);
    })
);

it.effect(
  "links only allowlisted accounts and never persists plaintext OAuth tokens",
  () =>
    Effect.gen(function* testGoogleAuth() {
      const { auth, authorize } = fixture();
      const signedIn = yield* authorize("joel@example.test");
      expect(signedIn.response.headers.get("location")).toBe("/");

      const linked = yield* authorize(
        "second@example.test",
        signedIn.cookie,
        true
      );

      expect(linked.response.headers.get("location")).toBe("/");

      const refused = yield* authorize(
        "outsider@example.test",
        signedIn.cookie,
        true
      );

      expect(refused.response.headers.get("location")).toContain("/refused");
      const context = yield* authContext(auth);

      const rows = yield* Effect.promise(
        context.adapter.findMany.bind(context.adapter, { model: "account" })
      );

      const accounts = yield* Schema.decodeUnknownEffect(
        Schema.Array(StoredTokens)
      )(rows);

      expect(accounts.map((account) => account.googleEmail).toSorted()).toEqual(
        ["joel@example.test", "second@example.test"]
      );
      expect(new Set(accounts.map((account) => account.userId)).size).toBe(1);

      for (const account of accounts) {
        expect(account.accessToken).not.toContain("fake-google-access");
        expect(account.refreshToken).not.toContain("fake-google-refresh");
        expect(account.idToken).toBeNull();

        const access = yield* Effect.promise(
          symmetricDecrypt.bind(undefined, {
            data: account.accessToken,
            key: config.secret,
          })
        );

        expect(access).toMatch(/^fake-google-access-/u);

        const refresh = yield* Effect.promise(
          symmetricDecrypt.bind(undefined, {
            data: account.refreshToken,
            key: config.secret,
          })
        );

        expect(refresh).toMatch(/^fake-google-refresh-/u);
      }

      expect(
        yield* Effect.promise(
          context.adapter.findMany.bind(context.adapter, { model: "user" })
        )
      ).toHaveLength(1);
    })
);

const tokenClient = (status: number, body: string, calls: string[]) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      calls.push(request.url);

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(body, {
            headers: { "content-type": "application/json" },
            status,
          })
        )
      );
    })
  );

it.effect(
  "returns cached access tokens, refreshes on demand, encrypts rotations, and isolates account ownership",
  () =>
    Effect.gen(function* testGoogleAuth() {
      const { auth, authorize } = fixture();
      yield* authorize("joel@example.test");
      const context = yield* authContext(auth);

      const rows = yield* Effect.promise(
        context.adapter.findMany.bind(context.adapter, { model: "account" })
      );

      const accounts = yield* Schema.decodeUnknownEffect(
        Schema.Array(StoredTokens)
      )(rows);

      const [account] = accounts;
      expect(account).toBeDefined();

      if (!account) {
        return;
      }

      const calls: string[] = [];

      const tokens = yield* googleTokensFor(auth, account.userId, config).pipe(
        Effect.provide(
          tokenClient(
            200,
            JSON.stringify({
              access_token: "rotated-access",
              expires_in: 3600,
              refresh_token: "rotated-refresh",
              token_type: "Bearer",
            }),
            calls
          )
        )
      );

      expect(Redacted.value(yield* tokens.accessToken(account.id))).toMatch(
        /^fake-google-access-/u
      );
      expect(calls).toHaveLength(0);
      expect(
        Redacted.value(
          yield* tokens.accessToken(account.id, { forceRefresh: true })
        )
      ).toBe("rotated-access");
      expect(calls).toEqual(["https://oauth2.googleapis.com/token"]);

      const updatedRows = yield* Effect.promise(
        context.adapter.findMany.bind(context.adapter, { model: "account" })
      );

      const updated = yield* Schema.decodeUnknownEffect(
        Schema.Array(StoredTokens)
      )(updatedRows);

      expect(JSON.stringify(updated)).not.toContain("rotated-access");
      expect(JSON.stringify(updated)).not.toContain("rotated-refresh");
      expect(Redacted.value(yield* tokens.accessToken(account.id))).toBe(
        "rotated-access"
      );
      expect(calls).toHaveLength(1);

      const stranger = yield* googleTokensFor(
        auth,
        "another-user",
        config
      ).pipe(Effect.provide(tokenClient(200, "{}", [])));

      expect(yield* stranger.accounts()).toEqual([]);
      expect(
        (yield* Effect.flip(stranger.accessToken(account.id))).reason
      ).toBe("unavailable");
    })
);

it.effect(
  "persists invalid_grant as disconnected and does not retry a disconnected account",
  () =>
    Effect.gen(function* testGoogleAuth() {
      const { auth, authorize } = fixture();
      yield* authorize("joel@example.test");
      const context = yield* authContext(auth);

      const rows = yield* Effect.promise(
        context.adapter.findMany.bind(context.adapter, { model: "account" })
      );

      const accounts = yield* Schema.decodeUnknownEffect(
        Schema.Array(StoredTokens)
      )(rows);

      const [account] = accounts;
      expect(account).toBeDefined();

      if (!account) {
        return;
      }

      const calls: string[] = [];

      const tokens = yield* googleTokensFor(auth, account.userId, config).pipe(
        Effect.provide(
          tokenClient(400, JSON.stringify({ error: "invalid_grant" }), calls)
        )
      );

      expect(
        (yield* Effect.flip(
          tokens.accessToken(account.id, { forceRefresh: true })
        )).reason
      ).toBe("disconnected");
      expect((yield* tokens.accounts())[0]?.disconnected).toBe(true);
      expect((yield* Effect.flip(tokens.accessToken(account.id))).reason).toBe(
        "disconnected"
      );
      expect(calls).toHaveLength(1);
    })
);

it.effect(
  "the checked-in SQL migration supports encrypted OAuth and linked accounts",
  () =>
    Effect.gen(function* sqliteAuthSeam() {
      const database = yield* Effect.acquireRelease(
        Effect.sync(() => new DatabaseSync(":memory:")),
        (connection) => Effect.sync(connection.close.bind(connection))
      );

      yield* Effect.sync(() => {
        database.exec(
          readFileSync(
            new URL(
              "../../database/migrations/calendar/0001_auth.sql",
              import.meta.url
            ),
            "utf-8"
          )
        );
      });
      const { auth, authorize } = fixture(database);
      const signedIn = yield* authorize("joel@example.test");
      yield* authorize("second@example.test", signedIn.cookie, true);
      yield* authorize("outsider@example.test", signedIn.cookie, true);
      const context = yield* authContext(auth);

      const rows = yield* Effect.promise(
        context.adapter.findMany.bind(context.adapter, { model: "account" })
      );

      const accounts = yield* Schema.decodeUnknownEffect(
        Schema.Array(StoredTokens)
      )(rows);

      expect(accounts).toHaveLength(2);
      expect(JSON.stringify(accounts)).not.toContain("fake-google-access-");
      expect(JSON.stringify(accounts)).not.toContain("fake-google-refresh-");
      expect(accounts.every((account) => account.idToken === null)).toBe(true);
      expect(
        yield* Effect.promise(
          context.adapter.findMany.bind(context.adapter, { model: "user" })
        )
      ).toHaveLength(1);
    })
);

it.effect.prop(
  "token acquisition uses the cache exactly when the token is fresh and refresh is not forced",
  { expired: Schema.Boolean, forceRefresh: Schema.Boolean },
  ({ expired, forceRefresh }) =>
    Effect.gen(function* tokenAcquisitionProperty() {
      const { auth, authorize } = fixture();
      yield* authorize("joel@example.test");
      const context = yield* authContext(auth);

      const rows = yield* Effect.promise(
        context.adapter.findMany.bind(context.adapter, { model: "account" })
      );

      const accounts = yield* Schema.decodeUnknownEffect(
        Schema.Array(StoredTokens)
      )(rows);

      const account = yield* Schema.decodeUnknownEffect(StoredTokens)(
        accounts[0]
      );

      if (expired) {
        yield* Effect.promise(
          context.adapter.update.bind(context.adapter, {
            model: "account",
            update: {
              accessTokenExpiresAt: DateTime.toDateUtc(DateTime.makeUnsafe(-1)),
            },
            where: [{ field: "id", value: account.id }],
          })
        );
      }

      const calls: string[] = [];

      const tokens = yield* googleTokensFor(auth, account.userId, config).pipe(
        Effect.provide(
          tokenClient(
            200,
            JSON.stringify({
              access_token: "property-refreshed",
              expires_in: 3600,
              token_type: "Bearer",
            }),
            calls
          )
        )
      );

      const token = Redacted.value(
        yield* tokens.accessToken(account.id, { forceRefresh })
      );

      expect(calls.length).toBe(expired || forceRefresh ? 1 : 0);
      expect(token === "property-refreshed").toBe(expired || forceRefresh);
    }),
  { arbitrary: { runs: 30 } }
);

it.effect.prop(
  "generated token histories preserve cache, refresh, revocation, and reconnect semantics",
  {
    operations: Schema.Array(
      Schema.Literals(["cached", "force", "expire", "revoke", "reconnect"])
    ),
  },
  ({ operations }) =>
    Effect.gen(function* tokenHistory() {
      const { auth, authorize } = fixture();
      const signedIn = yield* authorize("joel@example.test");
      const context = yield* authContext(auth);

      const rows = yield* Effect.promise(
        context.adapter.findMany.bind(context.adapter, { model: "account" })
      );

      const account = yield* Schema.decodeUnknownEffect(StoredTokens)(rows[0]);
      const provider = { calls: 0, reject: false };

      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          provider.calls += 1;

          const body = provider.reject
            ? { error: "invalid_grant" }
            : {
                access_token: "history-refreshed",
                expires_in: 3600,
                token_type: "Bearer",
              };

          return HttpClientResponse.fromWeb(
            request,
            Response.json(body, { status: provider.reject ? 400 : 200 })
          );
        })
      );

      const tokens = yield* googleTokensFor(auth, account.userId, config).pipe(
        Effect.provideService(HttpClient.HttpClient, client)
      );

      const model = { calls: 0, connected: true, fresh: true };

      for (const operation of operations) {
        yield* Match.value(operation).pipe(
          Match.when("reconnect", () =>
            authorize("joel@example.test", signedIn.cookie, true).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  model.connected = true;
                  model.fresh = true;
                })
              )
            )
          ),
          Match.when("expire", () =>
            Effect.gen(function* expireToken() {
              yield* Effect.promise(
                context.adapter.update.bind(context.adapter, {
                  model: "account",
                  update: {
                    accessTokenExpiresAt: DateTime.toDateUtc(
                      DateTime.makeUnsafe(-1)
                    ),
                  },
                  where: [{ field: "id", value: account.id }],
                })
              );
              model.fresh = false;
            })
          ),
          Match.orElse((action) =>
            Effect.gen(function* acquireToken() {
              provider.reject = action === "revoke";

              const refreshes =
                model.connected && (action !== "cached" || !model.fresh);

              const disconnected =
                !model.connected || (refreshes && provider.reject);

              const outcome = yield* Effect.result(
                tokens.accessToken(account.id, {
                  forceRefresh: action !== "cached",
                })
              );

              if (refreshes) {
                model.calls += 1;
              }

              if (disconnected) {
                expect(Result.isFailure(outcome)).toBe(true);

                if (Result.isFailure(outcome)) {
                  expect(outcome.failure.reason).toBe("disconnected");
                }

                model.connected = false;
              } else {
                expect(Result.isSuccess(outcome)).toBe(true);
                model.fresh = true;
              }
            })
          )
        );

        expect(provider.calls).toBe(model.calls);
        expect((yield* tokens.accounts())[0]?.disconnected).toBe(
          !model.connected
        );
      }
    }),
  { arbitrary: { runs: 30 } }
);
