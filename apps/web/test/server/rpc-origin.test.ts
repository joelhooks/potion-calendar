import { makeFakeGoogle } from "@calendar/auth/dev/fake-google";
import { createGoogleAuth } from "@calendar/auth/google";
import { Calendar } from "@calendar/calendar/contracts";
import { expect, layer } from "@effect/vitest";
import { Cause, Context, Effect, Layer, Schema } from "effect";

import { seedFakePerson } from "../../src/dev/person.js";
import { rpcValue } from "./calendar-rpc.js";
import { nativeWorkerFixture } from "./native-worker-fixture.js";

const origin = "https://calendar.wzrrd.sh";

const calendarId = "origin-calendar@example.test";

interface OriginHeaders {
  readonly origin?: string;
  readonly site?: string;
}

const fixture = Effect.gen(function* originWorkerFixture() {
  const requests: {
    readonly hostname: string;
    readonly method: string;
    readonly path: string;
  }[] = [];

  const outbound = (request: Request) => {
    const url = new URL(request.url);
    requests.push({
      hostname: url.hostname,
      method: request.method,
      path: url.pathname,
    });

    if (requests.length > 128) {
      requests.shift();
    }

    if (
      url.hostname === "www.googleapis.com" &&
      url.pathname === "/calendar/v3/colors"
    ) {
      return Response.json({
        calendar: { "1": { background: "#112233", foreground: "#ffffff" } },
        event: {},
      });
    }

    if (
      url.hostname === "www.googleapis.com" &&
      request.method === "PATCH" &&
      url.pathname ===
        `/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}`
    ) {
      return Response.json({
        accessRole: "owner",
        backgroundColor: "#112233",
        colorId: "1",
        foregroundColor: "#ffffff",
        hidden: false,
        id: calendarId,
        primary: true,
        selected: true,
        summary: "Origin fixture",
        timeZone: "UTC",
      });
    }

    return new Response(null, { status: 503 });
  };

  const { database, miniflare } = yield* nativeWorkerFixture(origin, outbound);
  const provider = makeFakeGoogle(origin);

  const config = {
    allowedEmails: "joel@example.test,second@example.test",
    baseURL: origin,
    clientId: "calendar-local",
    clientSecret: "fixture-client-secret",
    secret: "fixture-only-secret-at-least-thirty-two-characters",
    tokenEndpoint: `${origin}/__fake-google/token`,
  };

  const auth = createGoogleAuth(config, database, provider.provider);

  const person = yield* seedFakePerson({
    ...provider,
    auth,
    config,
    provider: provider.provider,
  });

  const raw: unknown = yield* Effect.tryPromise({
    catch: (cause) =>
      new Cause.UnknownError(cause, "Origin fixture account lookup failed"),
    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
    try: () =>
      database
        .prepare(
          "SELECT id FROM account WHERE userId = ? AND accountId = ? AND providerId = 'google'"
        )
        .bind(person.personId, "joel@example.test")
        .first(),
  });

  const account = yield* Schema.decodeUnknownEffect(
    Schema.Struct({ id: Schema.NonEmptyString })
  )(raw);

  const tables = [
    "user",
    "session",
    "account",
    "verification",
    "calendar_snapshot",
    "calendar_range",
    "google_push_channel",
    "calendar_account_disconnect",
  ];

  const audit = [
    database.prepare(
      "CREATE TABLE rpc_origin_writes (target TEXT NOT NULL, operation TEXT NOT NULL)"
    ),
    ...tables.flatMap((table) =>
      ["INSERT", "UPDATE", "DELETE"].map((operation) =>
        database.prepare(
          `CREATE TRIGGER rpc_origin_${table}_${operation.toLowerCase()} AFTER ${operation} ON "${table}" BEGIN INSERT INTO rpc_origin_writes (target, operation) VALUES ('${table}', '${operation}'); END`
        )
      )
    ),
  ];

  yield* Effect.tryPromise({
    catch: (cause) =>
      new Cause.UnknownError(cause, "Origin fixture audit setup failed"),
    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
    try: () => database.batch(audit),
  });

  const writeCount = Effect.tryPromise({
    catch: (cause) =>
      new Cause.UnknownError(cause, "Origin fixture write count failed"),
    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
    try: () =>
      database
        .prepare("SELECT count(*) AS count FROM rpc_origin_writes")
        .first(),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Struct({ count: Schema.Int }))
    ),
    Effect.map((row) => row.count)
  );

  const send = (input: OriginHeaders, path = "/rpc") =>
    Effect.gen(function* sendOriginRequest() {
      const headers = new Headers({
        "content-type": "application/json",
        cookie: person.cookie,
      });

      if (input.origin !== undefined) {
        headers.set("origin", input.origin);
      }

      if (input.site !== undefined) {
        headers.set("sec-fetch-site", input.site);
      }

      return yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Origin fixture RPC request failed"),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () =>
          miniflare.dispatchFetch(`${origin}${path}`, {
            body: `{"_tag":"Request","headers":[],"id":"1","payload":${JSON.stringify({ accountId: account.id, calendarId, colorId: "1", hidden: false, selected: true })},"tag":"setCalendarAppearance"}`,
            headers: [...headers],
            method: "POST",
          }),
      });
    });

  return { requests, send, writeCount };
});

class RpcOriginFixture extends Context.Service<
  RpcOriginFixture,
  Effect.Success<typeof fixture>
>()("test/RpcOriginFixture") {}

const nearOrigin = Schema.Literals([
  "schemeCase",
  "hostCase",
  "port",
  "trailingDot",
  "userinfo",
  "prefix",
]);

const changedOrigin = (kind: typeof nearOrigin.Type, number: number) => {
  switch (kind) {
    case "schemeCase": {
      return "HTTPS://calendar.wzrrd.sh";
    }

    case "hostCase": {
      return "https://Calendar.wzrrd.sh";
    }

    case "port": {
      return `${origin}:${number}`;
    }

    case "trailingDot": {
      return "https://calendar.wzrrd.sh.";
    }

    case "userinfo": {
      return `https://u${number}@calendar.wzrrd.sh`;
    }

    case "prefix": {
      return `${origin}.evil${number}.wzrrd.sh`;
    }

    default: {
      throw new Error("Unknown origin variant");
    }
  }
};

layer(Layer.effect(RpcOriginFixture, fixture), { excludeTestServices: true })(
  "Worker RPC origin fence",
  (it) => {
    it.effect.each(["/rpc", "/rpc/"])(
      "the signed-in app origin reaches RPC and performs the intended write at %s",
      (path) =>
        Effect.gen(function* acceptedOrigin() {
          const worker = yield* RpcOriginFixture;
          const before = yield* worker.writeCount;
          const requests = worker.requests.length;

          const response = yield* worker.send(
            { origin, site: "same-origin" },
            path
          );

          expect(response.status).toBe(200);

          const body: unknown = yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(cause, "Accepted RPC body failed"),
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () => response.json(),
          });

          const value = yield* Schema.decodeUnknownEffect(rpcValue(Calendar))(
            body
          );

          expect(value[0].exit.value.calendarId).toBe(calendarId);
          expect(worker.requests.length).toBeGreaterThan(requests);
          expect(yield* worker.writeCount).toBeGreaterThan(before);
        })
    );

    const refused: readonly (OriginHeaders & { readonly label: string })[] = [
      { label: "sibling origin", origin: "https://evil.wzrrd.sh" },
      { label: "opaque origin", origin: "null" },
      { label: "missing origin" },
      { label: "case-changed host", origin: "https://Calendar.wzrrd.sh" },
      { label: "prefix origin", origin: `${origin}.evil.wzrrd.sh` },
      {
        label: "userinfo origin",
        origin: "https://calendar.wzrrd.sh@evil.wzrrd.sh",
      },
      { label: "explicit default port", origin: `${origin}:443` },
      { label: "same-site metadata", origin, site: "same-site" },
      { label: "cross-site metadata", origin, site: "cross-site" },
      { label: "none metadata", origin, site: "none" },
      { label: "unrecognized metadata", origin, site: "unexpected" },
    ];

    it.effect.each(refused)(
      "a signed-in request with $label is refused before provider calls and D1 writes",
      (input) =>
        Effect.gen(function* refusedOrigin() {
          const worker = yield* RpcOriginFixture;
          const writes = yield* worker.writeCount;
          const requests = worker.requests.length;
          const response = yield* worker.send(input);
          expect(response.status).toBe(403);
          expect(yield* Effect.promise(response.text.bind(response))).toBe("");
          expect(worker.requests).toHaveLength(requests);
          expect(yield* worker.writeCount).toBe(writes);
        })
    );

    it.effect.prop(
      "near-origin case, port, dot, userinfo and prefix strings never inherit app write authority",
      {
        kind: nearOrigin,
        number: Schema.Int.check(
          Schema.isBetween({ maximum: 65_535, minimum: 1 })
        ),
        path: Schema.Literals(["/rpc", "/rpc/"]),
      },
      ({ kind, number, path }) =>
        Effect.gen(function* nearOriginRefused() {
          const worker = yield* RpcOriginFixture;
          const writes = yield* worker.writeCount;
          const requests = worker.requests.length;

          const response = yield* worker.send(
            { origin: changedOrigin(kind, number) },
            path
          );

          expect(response.status).toBe(403);
          expect(yield* Effect.promise(response.text.bind(response))).toBe("");
          expect(worker.requests).toHaveLength(requests);
          expect(yield* worker.writeCount).toBe(writes);
        }),
      { arbitrary: { runs: 30 } }
    );
  }
);
