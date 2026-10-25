// @effect-diagnostics-next-line nodeBuiltinImport:off -- This seam loads the existing auth migration without changing its schema.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { expect, it } from "@effect/vitest";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { Effect, Schema } from "effect";

import { makeFakeGoogle } from "../src/dev/fake-google.js";
import { googleAuthOptions } from "../src/google.js";

const config = {
  allowedEmails: "joel@example.test, second@example.test",
  baseURL: "http://calendar.test",
  clientId: "calendar-local",
  clientSecret: "local-only-client-secret",
  secret: "local-only-auth-secret-at-least-thirty-two-characters",
};

const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

const profileFixture = Effect.gen(function* profileFixture() {
  const database = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (connection) => Effect.sync(connection.close.bind(connection))
  );

  database.exec(
    readFileSync(
      new URL(
        "../../database/migrations/calendar/0001_auth.sql",
        import.meta.url
      ),
      "utf-8"
    )
  );
  const fake = makeFakeGoogle(config.baseURL);

  const auth = betterAuth<BetterAuthOptions>({
    ...googleAuthOptions(config, fake.provider),
    database,
  });

  const authorize = Effect.fn("test.authorizeProfile")(function* authorize(
    email: string
  ) {
    const start = yield* Effect.promise(
      auth.handler.bind(
        auth,
        new Request(`${config.baseURL}/auth/sign-in/oauth2`, {
          body: JSON.stringify({ callbackURL: "/", providerId: "google" }),
          headers: {
            "content-type": "application/json",
            origin: config.baseURL,
          },
          method: "POST",
        })
      )
    );

    expect(start.status).toBe(200);
    const body = yield* Effect.promise(start.json.bind(start));

    const location = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ url: Schema.String })
    )(body);

    const callback = fake.authorize(new URL(location.url), email);

    const response = yield* Effect.promise(
      auth.handler.bind(
        auth,
        new Request(callback, { headers: { cookie: cookieHeader(start) } })
      )
    );

    expect(response.status).toBe(302);

    return cookieHeader(response);
  });

  const update = (
    cookie: string,
    body: Record<string, string | number>,
    endpoint = "/auth/update-user"
  ) =>
    Effect.promise(
      auth.handler.bind(
        auth,
        new Request(`${config.baseURL}${endpoint}`, {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            cookie,
            origin: config.baseURL,
          },
          method: "POST",
        })
      )
    );

  const names = () =>
    Schema.decodeUnknownSync(
      Schema.Array(
        Schema.Struct({
          email: Schema.String,
          image: Schema.NullOr(Schema.String),
          name: Schema.String,
        })
      )
    )(
      database
        .prepare('SELECT email, image, name FROM "user" ORDER BY email')
        .all()
    );

  return { auth, authorize, names, update };
});

it.effect(
  "the authenticated profile write trims only the current user's name and leaves both identities intact",
  () =>
    Effect.gen(function* ownProfile() {
      const f = yield* profileFixture;
      const first = yield* f.authorize("joel@example.test");
      const second = yield* f.authorize("second@example.test");
      const before = f.names();
      const response = yield* f.update(first, { name: "  Joel Hooks  " });
      expect(response.status).toBe(200);
      expect(f.names()).toEqual(
        before.map((person) =>
          person.email === "joel@example.test"
            ? { ...person, name: "Joel Hooks" }
            : person
        )
      );

      const refreshed = yield* Effect.promise(
        f.auth.api.getSession.bind(f.auth.api, {
          headers: new Headers({ cookie: first }),
        })
      );

      expect(refreshed?.user.name).toBe("Joel Hooks");

      const other = yield* Effect.promise(
        f.auth.api.getSession.bind(f.auth.api, {
          headers: new Headers({ cookie: second }),
        })
      );

      expect(other?.user.name).toBe(
        before.find((person) => person.email === "second@example.test")?.name
      );

      const secondWrite = yield* f.update(second, { name: "Second Person" });
      expect(secondWrite.status).toBe(200);
      expect(f.names()).toEqual(
        before.map((person) => ({
          ...person,
          name:
            person.email === "joel@example.test"
              ? "Joel Hooks"
              : "Second Person",
        }))
      );

      const signedInAgain = yield* f.authorize("joel@example.test");

      const persisted = yield* Effect.promise(
        f.auth.api.getSession.bind(f.auth.api, {
          headers: new Headers({ cookie: signedInAgain }),
        })
      );

      expect(persisted?.user.name).toBe("Joel Hooks");
    })
);

it.effect.each(["/auth/update-user/", "/auth/%75pdate-user"])(
  "alternate profile path %s cannot bypass name-only validation",
  (endpoint) =>
    Effect.gen(function* profilePathFence() {
      const f = yield* profileFixture;
      const cookie = yield* f.authorize("joel@example.test");
      const before = f.names();

      const response = yield* f.update(
        cookie,
        { image: "https://calendar.test/unwanted.svg", name: "" },
        endpoint
      );

      expect(response.status).not.toBe(200);
      expect(f.names()).toEqual(before);
    })
);

it.effect.each(["", "   ", "x".repeat(101), "👩‍💻".repeat(101), 42])(
  "invalid profile name %s is refused before the durable write",
  (name) =>
    Effect.gen(function* invalidName() {
      const f = yield* profileFixture;
      const cookie = yield* f.authorize("joel@example.test");
      const before = f.names();
      const response = yield* f.update(cookie, { name });
      expect(response.status).toBe(400);
      expect(f.names()).toEqual(before);
    })
);

it.effect.each(["id", "userId", "email", "image"])(
  "profile body cannot smuggle the %s field into the auth write",
  (field) =>
    Effect.gen(function* nameOnlyBody() {
      const f = yield* profileFixture;
      const cookie = yield* f.authorize("joel@example.test");
      yield* f.authorize("second@example.test");
      const before = f.names();

      const response = yield* f.update(cookie, {
        [field]: "second@example.test",
        name: "Changed",
      });

      expect(response.status).toBe(400);
      expect(f.names()).toEqual(before);
    })
);

it.effect(
  "the 100-character edge and unrestricted name characters remain supported",
  () =>
    Effect.gen(function* allowedNames() {
      const f = yield* profileFixture;
      const cookie = yield* f.authorize("joel@example.test");

      for (const name of [
        "x".repeat(100),
        "👩‍💻".repeat(100),
        "Á".repeat(100),
        "O'Connor · 李 / 123 <profile>",
      ]) {
        const response = yield* f.update(cookie, { name });
        expect(response.status).toBe(200);
        expect(f.names()[0]?.name).toBe(name);
      }
    })
);

it.effect("profile update without a session cannot write a user", () =>
  Effect.gen(function* unauthenticatedProfile() {
    const f = yield* profileFixture;
    yield* f.authorize("joel@example.test");
    const before = f.names();
    const response = yield* f.update("", { name: "Unauthenticated" });
    expect(response.status).toBe(401);
    expect(f.names()).toEqual(before);
  })
);
