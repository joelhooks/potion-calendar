import { desktopHandoffStore } from "@calendar/auth/desktop";
import { makeFakeGoogle } from "@calendar/auth/dev/fake-google";
import { createGoogleAuth } from "@calendar/auth/google";
import type { GoogleAuth } from "@calendar/auth/google";
import { expect, it } from "@effect/vitest";
import { Effect, Match, Schema } from "effect";

import { desktopRoutesWithAuth } from "../../src/server/desktop-routes.js";
import { d1Fixture } from "./d1-fixture.js";

const config = {
  allowedEmails: "joel@example.test,second@example.test",
  baseURL: "https://calendar.test",
  clientId: "calendar-local",
  clientSecret: "local-client-secret",
  secret: "local-only-auth-secret-at-least-thirty-two-characters",
};

const Document = Schema.Struct({ url: Schema.String });

const cookieJar = (response: Response, existing = "") =>
  [
    existing,
    ...response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0] ?? ""),
  ]
    .filter(Boolean)
    .join("; ");

const call = (auth: GoogleAuth, request: Request) =>
  Effect.promise(auth.handler.bind(auth, request));

const fixture = Effect.gen(function* fixture() {
  const database = yield* d1Fixture;
  const fake = makeFakeGoogle(config.baseURL);

  const auth = createGoogleAuth(
    { ...config, desktopStore: desktopHandoffStore(database) },
    database,
    fake.provider
  );

  const signIn = Effect.fn("test.desktop.signIn")(function* signIn(
    email: string
  ) {
    const start = yield* call(
      auth,
      new Request(`${config.baseURL}/auth/sign-in/oauth2`, {
        body: JSON.stringify({ callbackURL: "/", providerId: "google" }),
        headers: { "content-type": "application/json", origin: config.baseURL },
        method: "POST",
      })
    );

    const data: unknown = yield* Effect.promise(start.json.bind(start));
    const document = yield* Schema.decodeUnknownEffect(Document)(data);

    const response = yield* call(
      auth,
      new Request(fake.authorize(new URL(document.url), email), {
        headers: { cookie: cookieJar(start) },
      })
    );

    return cookieJar(response, cookieJar(start));
  });

  const state = "a".repeat(64);

  const issue = (cookie: string) =>
    Effect.promise(
      desktopRoutesWithAuth.bind(
        undefined,
        new Request(
          `${config.baseURL}/desktop/sign-in?port=49152&state=${state}`,
          {
            headers: { cookie, origin: config.baseURL },
            method: "POST",
          }
        ),
        config,
        auth
      )
    );

  const redeem = (token: string, cookie = "") =>
    Effect.promise(
      desktopRoutesWithAuth.bind(
        undefined,
        new Request(`${config.baseURL}/desktop/complete?token=${token}`, {
          headers: { cookie },
        }),
        config,
        auth
      )
    );

  const tokenFrom = (response: Response) =>
    new URL(
      response.headers.get("location") ?? config.baseURL
    ).searchParams.get("token") ?? "";

  return { auth, database, issue, redeem, signIn, tokenFrom };
});

it.effect(
  "desktop transfer atomically redeems once and uses normal secure session-cookie attributes",
  () =>
    Effect.gen(function* atomicRedemption() {
      const { signIn, issue, redeem, tokenFrom, auth } = yield* fixture;
      const cookie = yield* signIn("joel@example.test");
      const issued = yield* issue(cookie);
      expect(issued.status).toBe(303);
      const location = issued.headers.get("location") ?? "";
      expect(location).not.toContain("access_token");
      expect(location).not.toContain("refresh_token");
      const token = tokenFrom(issued);
      expect(token).toMatch(/^[a-f0-9]{64}$/u);

      const responses = yield* Effect.all([redeem(token), redeem(token)], {
        concurrency: "unbounded",
      });

      expect(
        responses.map((response) => response.status).toSorted((a, b) => a - b)
      ).toEqual([303, 400]);
      const successful = responses.find((response) => response.status === 303);
      expect(successful).toBeDefined();

      const setCookie =
        successful?.headers
          .getSetCookie()
          .find((value) =>
            value.startsWith("__Secure-better-auth.session_token=")
          ) ?? "";

      expect(setCookie).toContain("__Secure-better-auth.session_token=");
      expect(setCookie).toMatch(/;\s*httponly(?:;|$)/iu);
      expect(setCookie).toMatch(/;\s*secure(?:;|$)/iu);
      expect(setCookie).toMatch(/;\s*samesite=lax(?:;|$)/iu);

      const current = yield* Effect.promise(
        auth.api.getSession.bind(auth.api, {
          headers: new Headers({
            cookie: successful === undefined ? "" : cookieJar(successful),
          }),
        })
      );

      expect(current?.user.email).toBe("joel@example.test");
    }),
  30_000
);

for (const refusal of [
  "expired",
  "revoked",
  "wrong-person",
  "disallowed",
  "missing-person",
  "expired-session",
  "wrong-binding",
  "unverified",
]) {
  it.effect(
    `desktop transfer refuses ${refusal} before setting a cookie`,
    () =>
      Effect.gen(function* refusedRedemption() {
        const { signIn, issue, redeem, tokenFrom, database } = yield* fixture;
        const cookie = yield* signIn("joel@example.test");
        const second = yield* signIn("second@example.test");
        const issued = yield* issue(cookie);
        const token = tokenFrom(issued);

        const sql = Match.value(refusal).pipe(
          Match.when(
            "expired",
            () =>
              "UPDATE verification SET \"expiresAt\" = 0 WHERE identifier LIKE 'calendar-desktop:%'"
          ),
          Match.when(
            "revoked",
            () =>
              "DELETE FROM session WHERE \"userId\" IN (SELECT id FROM user WHERE email = 'joel@example.test')"
          ),
          Match.when(
            "disallowed",
            () =>
              "UPDATE user SET email = 'refused@example.test' WHERE email = 'joel@example.test'"
          ),
          Match.when(
            "missing-person",
            () => "DELETE FROM user WHERE email = 'joel@example.test'"
          ),
          Match.when(
            "expired-session",
            () =>
              'UPDATE session SET "expiresAt" = 0 WHERE "userId" IN (SELECT id FROM user WHERE email = \'joel@example.test\')'
          ),
          Match.when(
            "wrong-binding",
            () =>
              "UPDATE verification SET value = json_set(value, '$.personId', 'other-person') WHERE identifier LIKE 'calendar-desktop:%'"
          ),
          Match.when(
            "unverified",
            () =>
              "UPDATE user SET \"emailVerified\" = 0 WHERE email = 'joel@example.test'"
          ),
          Match.orElse(() => "SELECT 1")
        );

        const statement = database.prepare(sql);
        yield* Effect.promise(statement.run.bind(statement));

        const response = yield* redeem(
          token,
          refusal === "wrong-person" ? second : ""
        );

        expect(response.status).toBe(400);
        expect(response.headers.getSetCookie()).toEqual([]);
        expect((yield* redeem(token)).status).toBe(400);
      }),
    30_000
  );
}

it.effect(
  "desktop sign-in refuses invalid ports, missing state and session-less issuance",
  () =>
    Effect.gen(function* invalidIssuance() {
      const { auth, issue } = yield* fixture;

      for (const query of [
        `port=80&state=${"a".repeat(64)}`,
        `port=65536&state=${"a".repeat(64)}`,
        "port=49152",
        "port=49152&state=wrong",
        `port=49152&port=49153&state=${"a".repeat(64)}`,
      ]) {
        const response = yield* Effect.promise(
          desktopRoutesWithAuth.bind(
            undefined,
            new Request(`${config.baseURL}/desktop/sign-in?${query}`),
            config,
            auth
          )
        );

        expect(response.status).toBe(400);
      }

      expect((yield* issue("")).status).toBe(400);

      const anonymous = yield* call(
        auth,
        new Request(`${config.baseURL}/auth/desktop/issue`)
      );

      expect(anonymous.status).not.toBe(200);
    }),
  30_000
);
