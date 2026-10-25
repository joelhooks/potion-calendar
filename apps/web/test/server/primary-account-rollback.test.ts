// @effect-diagnostics-next-line nodeBuiltinImport:off -- The rollback regression applies the approved SQL to an exact-base D1 fixture as well as the current fixture.
import { readFileSync } from "node:fs";

import { makeFakeGoogle } from "@calendar/auth/dev/fake-google";
import { createGoogleAuth } from "@calendar/auth/google";
import { SessionSnapshot } from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Schema } from "effect";

import { createBackend } from "../../src/server/backend.js";
import { d1Fixture } from "./d1-fixture.js";

const migration = readFileSync(
  new URL(
    "../../../../packages/database/migrations/calendar/0009_primary_calendar_account.sql",
    import.meta.url
  ),
  "utf-8"
);

const RpcRead = Schema.TaggedStruct("Request", {
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  id: Schema.String,
  payload: Schema.Struct({}),
  tag: Schema.Literal("session"),
});

const UrlDocument = Schema.Struct({ url: Schema.String });

const Columns = Schema.Array(Schema.Struct({ name: Schema.String }));

const Reply = Schema.NonEmptyArray(
  Schema.Struct({ exit: Schema.Struct({ value: SessionSnapshot }) })
);

const Pointer = Schema.Struct({
  primaryCalendarAccountId: Schema.NullOr(Schema.String),
});

const Subject = Schema.Struct({ accountId: Schema.String });

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

it.effect(
  "auth/session name writes and linked Google sign-ins remain compatible with migration 0009 and unlinking nulls its FK",
  () =>
    Effect.gen(function* rollbackCompatibleAuth() {
      const database = yield* d1Fixture;
      const statement = database.prepare('PRAGMA table_info("user")');
      const metadata = yield* Effect.promise(statement.all.bind(statement));

      const columns = yield* Schema.decodeUnknownEffect(Columns)(
        metadata.results
      );

      if (
        !columns.some((column) => column.name === "primaryCalendarAccountId")
      ) {
        const apply = database.prepare(migration);
        yield* Effect.promise(apply.run.bind(apply));
      }

      const config = {
        allowedEmails: "joel@example.test,linked@example.test",
        baseURL: "https://calendar.test",
        clientId: "calendar-local",
        clientSecret: "local-client-secret",
        secret: "local-only-auth-secret-at-least-thirty-two-characters",
      };

      const fake = makeFakeGoogle(config.baseURL);
      const auth = createGoogleAuth(config, database, fake.provider);

      const authorize = Effect.fn("test.primaryRollback.authorize")(
        function* authorize(email: string, cookie?: string, link?: boolean) {
          const currentCookie = cookie ?? "";

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
                    cookie: currentCookie,
                    origin: config.baseURL,
                  },
                  method: "POST",
                }
              )
            )
          );

          expect(start.status).toBe(200);
          const raw: unknown = yield* Effect.promise(start.json.bind(start));
          const document = yield* Schema.decodeUnknownEffect(UrlDocument)(raw);

          const callback = yield* Effect.promise(
            auth.handler.bind(
              auth,
              new Request(fake.authorize(new URL(document.url), email), {
                headers: { cookie: cookies(start, currentCookie) },
              })
            )
          );

          expect(callback.status).toBe(302);
          expect(
            new URL(
              callback.headers.get("location") ?? "/refused",
              config.baseURL
            ).pathname
          ).not.toBe("/refused");

          return cookies(callback, cookies(start, currentCookie));
        }
      );

      const snapshot = Effect.fn("test.primaryRollback.snapshot")(
        function* snapshot(cookie: string) {
          const request = new Request(`${config.baseURL}/rpc`, {
            body: JSON.stringify(
              RpcRead.make({
                headers: [],
                id: "1",
                payload: {},
                tag: "session",
              })
            ),
            headers: {
              "content-type": "application/json",
              cookie,
              origin: config.baseURL,
            },
            method: "POST",
          });

          const backend = yield* Effect.acquireRelease(
            Effect.sync(() => createBackend(auth, config, request.headers)),
            (current) => Effect.promise(current.dispose.bind(current))
          );

          const response = yield* Effect.promise(
            backend.handler.bind(backend, request, undefined)
          );

          expect(response.status).toBe(200);

          const raw: unknown = yield* Effect.promise(
            response.json.bind(response)
          );

          const frames = yield* Schema.decodeUnknownEffect(Reply)(raw);
          const current = frames[0].exit.value;

          if (current === null) {
            return yield* Effect.die(
              new Error(
                "The real auth/session compatibility fixture lost its person"
              )
            );
          }

          return current;
        }
      );

      let cookie = yield* authorize("joel@example.test");
      cookie = yield* authorize("linked@example.test", cookie, true);
      const before = yield* snapshot(cookie);
      expect(before.accounts).toHaveLength(2);

      const chosen = before.accounts.find(
        (account) => account.email === "linked@example.test"
      );

      if (chosen === undefined) {
        return yield* Effect.die(
          new Error(
            "The real linking callback did not create its selectable account"
          )
        );
      }

      const set = database
        .prepare(
          'UPDATE "user" SET "primaryCalendarAccountId" = ? WHERE id = ?'
        )
        .bind(chosen.id, before.user.id);

      yield* Effect.promise(set.run.bind(set));

      const updated = yield* Effect.promise(
        auth.handler.bind(
          auth,
          new Request(`${config.baseURL}/auth/update-user`, {
            body: JSON.stringify({ name: "  Rollback Name  " }),
            headers: {
              "content-type": "application/json",
              cookie,
              origin: config.baseURL,
            },
            method: "POST",
          })
        )
      );

      expect(updated.status).toBe(200);
      const after = yield* snapshot(cookie);
      expect(after.user).toMatchObject({
        email: before.user.email,
        id: before.user.id,
        name: "Rollback Name",
      });

      const pointer = Effect.gen(function* readPointer() {
        const read = database
          .prepare('SELECT "primaryCalendarAccountId" FROM "user" WHERE id = ?')
          .bind(before.user.id);

        const rows = yield* Effect.promise(read.all.bind(read));

        const decoded = yield* Schema.decodeUnknownEffect(
          Schema.NonEmptyArray(Pointer)
        )(rows.results);

        return decoded[0];
      });

      expect(yield* pointer).toEqual({ primaryCalendarAccountId: chosen.id });

      for (const email of ["joel@example.test", "linked@example.test"]) {
        const signedIn = yield* snapshot(yield* authorize(email));
        expect(signedIn.user).toMatchObject({
          email: before.user.email,
          id: before.user.id,
          name: "Rollback Name",
        });
        expect(
          signedIn.accounts.map((account) => account.id).toSorted()
        ).toEqual(before.accounts.map((account) => account.id).toSorted());
        expect(yield* pointer).toEqual({ primaryCalendarAccountId: chosen.id });
      }

      const readSubject = database
        .prepare('SELECT "accountId" FROM account WHERE id = ?')
        .bind(chosen.id);

      const subjectRows = yield* Effect.promise(
        readSubject.all.bind(readSubject)
      );

      const subjects = yield* Schema.decodeUnknownEffect(
        Schema.NonEmptyArray(Subject)
      )(subjectRows.results);

      const [subject] = subjects;

      const removed = yield* Effect.promise(
        auth.handler.bind(
          auth,
          new Request(`${config.baseURL}/auth/unlink-account`, {
            body: JSON.stringify({
              accountId: subject.accountId,
              providerId: "google",
            }),
            headers: {
              "content-type": "application/json",
              cookie,
              origin: config.baseURL,
            },
            method: "POST",
          })
        )
      );

      expect(removed.status).toBe(404);

      const unlinked = yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Local Better Auth unlink failed"),
        // oxlint-disable-next-line typescript/promise-function-async -- The regression invokes Better Auth's trusted server API; its HTTP unlink route remains disabled.
        try: () =>
          auth.api.unlinkAccount({
            asResponse: true,
            body: { accountId: subject.accountId, providerId: "google" },
            headers: new Headers({ cookie, origin: config.baseURL }),
          }),
      });

      expect(unlinked.status).toBe(200);
      expect(yield* pointer).toEqual({ primaryCalendarAccountId: null });
      expect(
        (yield* snapshot(cookie)).accounts.map((account) => account.id)
      ).toEqual(
        before.accounts
          .filter((account) => account.id !== chosen.id)
          .map((account) => account.id)
      );

      return yield* Effect.void;
    })
);
