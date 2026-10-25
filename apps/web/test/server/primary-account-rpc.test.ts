import { makeFakeGoogle } from "@calendar/auth/dev/fake-google";
import { createGoogleAuth } from "@calendar/auth/google";
import {
  ProfileUpdateRefused,
  SavedProfile,
  SessionSnapshot,
} from "@calendar/core/contracts";
import { profileRepository } from "@calendar/database/profile";
import { expect, it } from "@effect/vitest";
import { Effect, Match, Schema } from "effect";

import { seedFakePerson } from "../../src/dev/person.js";
import { createBackend } from "../../src/server/backend.js";
import { d1CalendarStore } from "../../src/server/calendar-store.js";
import { rpcFailure, rpcValue } from "./calendar-rpc.js";
import { d1Fixture } from "./d1-fixture.js";

const ProfileRpcDocument = Schema.NonEmptyArray(
  Schema.Struct({ exit: Schema.Record(Schema.String, Schema.Json) })
);

const RpcRequest = Schema.TaggedStruct("Request", {
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  id: Schema.String,
  payload: Schema.Json,
  tag: Schema.String,
});

const expectRefusal = (body: typeof ProfileRpcDocument.Type) =>
  Effect.sync(() => {
    expect(body[0].exit._tag).toBe("Failure");
  });

const fixture = Effect.gen(function* primaryRpcFixture() {
  const database = yield* d1Fixture;

  const config = {
    allowedEmails:
      "joel@example.test,second@example.test,third@example.test,fourth@example.test",
    baseURL: "http://calendar.test",
    clientId: "calendar-local",
    clientSecret: "local-client-secret",
    secret: "local-only-auth-secret-at-least-thirty-two-characters",
  };

  const provider = makeFakeGoogle(config.baseURL);
  const auth = createGoogleAuth(config, database, provider.provider);
  const fake = { ...provider, auth, config };

  const first = yield* seedFakePerson(fake, [
    "joel@example.test",
    "second@example.test",
  ]);

  const second = yield* seedFakePerson(fake, ["third@example.test"]);

  const rpc = Effect.fn("test.primaryRpc.request")(function* rpc(
    tag: string,
    payload: Schema.Json,
    cookie: string = first.cookie
  ) {
    const request = new Request(`${config.baseURL}/rpc`, {
      body: JSON.stringify(
        RpcRequest.make({
          headers: [],
          id: "1",
          payload,
          tag,
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
      Effect.sync(() =>
        createBackend(auth, config, request.headers, {
          saveProfile: (personId, input) =>
            profileRepository(database, personId, config.allowedEmails).save(
              input
            ),
          storeFor: (personId) => d1CalendarStore(database, personId),
        })
      ),
      (current) => Effect.promise(current.dispose.bind(current))
    );

    const response = yield* Effect.promise(
      backend.handler.bind(backend, request, undefined)
    );

    const body: unknown = yield* Effect.promise(response.json.bind(response));

    return yield* Schema.decodeUnknownEffect(ProfileRpcDocument)(body);
  });

  const session = Effect.fn("test.primaryRpc.session")(function* session(
    cookie: string = first.cookie
  ) {
    const frames = yield* rpc("session", {}, cookie).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(SessionSnapshot)))
    );

    const snapshot = frames[0].exit.value;

    if (
      snapshot === null ||
      snapshot.profileUpdateProof === undefined ||
      snapshot.accountDeletionProof === undefined
    ) {
      return yield* Effect.die(
        new Error("Real profile RPC fixture lacks a confirmed current session")
      );
    }

    return {
      ...snapshot,
      accountDeletionProof: snapshot.accountDeletionProof,
      profileUpdateProof: snapshot.profileUpdateProof,
    };
  });

  const snapshot = yield* session();
  const other = yield* session(second.cookie);

  const linked = snapshot.accounts.find(
    (account) => account.email === "second@example.test"
  );

  expect(snapshot.accounts).toHaveLength(2);
  expect(linked).toBeDefined();

  if (linked === undefined) {
    return yield* Effect.die(
      new Error("Real profile RPC fixture lacks its linked account")
    );
  }

  return {
    auth,
    config,
    database,
    fake,
    first,
    linked,
    other,
    rpc,
    second,
    session,
    snapshot,
  };
});

it.effect(
  "the actual authenticated capability persists one atomic name/primary update and both linked Google accounts still sign into the same person",
  () =>
    Effect.gen(function* primaryCapabilityRoundtrip() {
      const f = yield* fixture;

      const payload = {
        name: "  Atomic Name  ",
        primaryAccountId: f.linked.id,
        proof: f.snapshot.profileUpdateProof,
      };

      const frames = yield* f
        .rpc("saveProfile", payload)
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(SavedProfile)))
        );

      expect(frames[0].exit.value).toEqual({
        name: "Atomic Name",
        primaryAccountId: f.linked.id,
      });
      expect((yield* f.session()).user).toMatchObject({
        email: f.snapshot.user.email,
        id: f.first.personId,
        name: "Atomic Name",
        primaryAccountId: f.linked.id,
      });
      expect((yield* f.session(f.second.cookie)).user).toEqual(f.other.user);

      for (const email of ["joel@example.test", "second@example.test"]) {
        const signedIn = yield* seedFakePerson(f.fake, [email]);
        expect(signedIn.personId).toBe(f.first.personId);
        const current = yield* f.session(signedIn.cookie);
        expect(current.user).toMatchObject({
          email: f.snapshot.user.email,
          id: f.first.personId,
          name: "Atomic Name",
          primaryAccountId: f.linked.id,
        });
        expect(
          current.accounts.map((account) => account.id).toSorted()
        ).toEqual(f.snapshot.accounts.map((account) => account.id).toSorted());
      }
    })
);

it.effect.each([
  "foreign-cookie",
  "foreign-account",
  "stale-session",
  "wrong-proof",
  "deletion-proof",
] as const)(
  "the actual profile RPC refuses %s without writing A or B",
  (kind) =>
    Effect.gen(function* primaryRpcRefusal() {
      const f = yield* fixture;
      const [otherAccount] = f.other.accounts;
      expect(otherAccount).toBeDefined();

      if (otherAccount === undefined) {
        return;
      }

      let { cookie } = f.first;

      if (kind === "foreign-cookie") {
        ({ cookie } = f.second);
      } else if (kind === "stale-session") {
        ({ cookie } = yield* seedFakePerson(f.fake, ["joel@example.test"]));
      }

      const payload = {
        name: "Must not persist",
        primaryAccountId:
          kind === "foreign-account" ? otherAccount.id : f.linked.id,
        proof: Match.value(kind).pipe(
          Match.when("wrong-proof", () => "0".repeat(64)),
          Match.when("deletion-proof", () => f.snapshot.accountDeletionProof),
          Match.orElse(() => f.snapshot.profileUpdateProof)
        ),
      };

      const body = yield* f.rpc("saveProfile", payload, cookie);
      yield* expectRefusal(body);
      yield* Schema.decodeUnknownEffect(rpcFailure(ProfileUpdateRefused))(body);
      expect((yield* f.session()).user).toEqual(f.snapshot.user);
      expect((yield* f.session(f.second.cookie)).user).toEqual(f.other.user);
    })
);

it.effect(
  "reconnecting a selected disabled Google account retains its account.id and durable primary pointer",
  () =>
    Effect.gen(function* reconnectPrimary() {
      const f = yield* fixture;
      yield* f
        .rpc("saveProfile", {
          name: f.snapshot.user.name,
          primaryAccountId: f.linked.id,
          proof: f.snapshot.profileUpdateProof,
        })
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(SavedProfile)))
        );

      const statement = f.database
        .prepare("UPDATE account SET disconnected = 1 WHERE id = ?")
        .bind(f.linked.id);

      yield* Effect.promise(statement.run.bind(statement));

      const disabled = yield* f.session();
      expect(disabled.user.primaryAccountId).toBe(f.linked.id);
      expect(
        disabled.accounts.find((account) => account.id === f.linked.id)
          ?.disconnected
      ).toBe(true);

      const person = yield* seedFakePerson(f.fake, ["second@example.test"], {
        cookie: f.first.cookie,
      });

      expect(person.personId).toBe(f.first.personId);

      const current = yield* f.session(person.cookie);
      expect(current.user.primaryAccountId).toBe(f.linked.id);
      expect(
        current.accounts.find((account) => account.id === f.linked.id)
          ?.disconnected
      ).toBe(false);
      expect(current.accounts.map((account) => account.id).toSorted()).toEqual(
        f.snapshot.accounts.map((account) => account.id).toSorted()
      );
    })
);

it.effect(
  "linking another allowed Google account does not replace an explicitly selected primary",
  () =>
    Effect.gen(function* linkAfterPrimaryChoice() {
      const f = yield* fixture;
      yield* f
        .rpc("saveProfile", {
          name: f.snapshot.user.name,
          primaryAccountId: f.linked.id,
          proof: f.snapshot.profileUpdateProof,
        })
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(rpcValue(SavedProfile)))
        );

      const person = yield* seedFakePerson(f.fake, ["fourth@example.test"], {
        cookie: f.first.cookie,
      });

      expect(person.personId).toBe(f.first.personId);

      const current = yield* f.session(person.cookie);
      expect(current.accounts).toHaveLength(3);
      expect(
        current.accounts.some(
          (account) => account.email === "fourth@example.test"
        )
      ).toBe(true);
      expect(current.user.primaryAccountId).toBe(f.linked.id);
      expect((yield* f.session(f.second.cookie)).user).toEqual(f.other.user);
    })
);

it.effect.each([
  { label: "required", name: "   " },
  { label: "length", name: "x".repeat(101) },
])(
  "the combined capability enforces the existing $label name rule without changing the primary",
  ({ name }) =>
    Effect.gen(function* rejectInvalidProfileName() {
      const f = yield* fixture;

      const body = yield* f.rpc("saveProfile", {
        name,
        primaryAccountId: f.linked.id,
        proof: f.snapshot.profileUpdateProof,
      });

      yield* expectRefusal(body);
      yield* Schema.decodeUnknownEffect(rpcFailure(ProfileUpdateRefused))(body);
      expect((yield* f.session()).user).toEqual(f.snapshot.user);
    })
);

it.effect(
  "Better Auth's existing name-only endpoint refuses the read-only pointer without a partial name write",
  () =>
    Effect.gen(function* rejectAuthPointerWrite() {
      const f = yield* fixture;

      const request = new Request(`${f.config.baseURL}/auth/update-user`, {
        body: JSON.stringify({
          name: "Must not persist",
          primaryCalendarAccountId: f.linked.id,
        }),
        headers: {
          "content-type": "application/json",
          cookie: f.first.cookie,
          origin: f.config.baseURL,
        },
        method: "POST",
      });

      const response = yield* Effect.promise(
        f.auth.handler.bind(f.auth, request)
      );

      expect(response.status).toBe(400);
      expect((yield* f.session()).user).toEqual(f.snapshot.user);
    })
);

it.effect(
  "an unverified current session cannot use the profile capability",
  () =>
    Effect.gen(function* rejectUnverifiedProfile() {
      const f = yield* fixture;

      const statement = f.database
        .prepare('UPDATE "user" SET "emailVerified" = 0 WHERE id = ?')
        .bind(f.first.personId);

      yield* Effect.promise(statement.run.bind(statement));

      const body = yield* f.rpc("saveProfile", {
        name: "Must not persist",
        primaryAccountId: f.linked.id,
        proof: f.snapshot.profileUpdateProof,
      });

      yield* expectRefusal(body);
      yield* Schema.decodeUnknownEffect(rpcFailure(ProfileUpdateRefused))(body);
      expect((yield* f.session()).user).toEqual(f.snapshot.user);
    })
);

it.effect.each(["email", "personId", "userId", "primaryCalendarAccountId"])(
  "the public profile contract rejects a forged %s field before persistence",
  (field) =>
    Effect.gen(function* rejectProfileAuthorityField() {
      const f = yield* fixture;

      const body = yield* f.rpc("saveProfile", {
        name: "Must not persist",
        primaryAccountId: f.linked.id,
        proof: f.snapshot.profileUpdateProof,
        [field]: f.other.user.id,
      });

      yield* expectRefusal(body);
      expect((yield* f.session()).user).toEqual(f.snapshot.user);
      expect((yield* f.session(f.second.cookie)).user).toEqual(f.other.user);
    })
);
