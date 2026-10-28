// @effect-diagnostics-next-line nodeBuiltinImport:off -- The Vite-only composition reads the workspace SQL migrations before starting its local D1 fixture.
import { readFile } from "node:fs/promises";

import { makeFakeGoogle } from "@calendar/auth/dev/fake-google";
import { createGoogleAuth } from "@calendar/auth/google";
import { GoogleHttp } from "@calendar/calendar";
import type { GoogleRequestValue } from "@calendar/calendar";
import { Cause, Clock, Context, Effect, Layer, Schema } from "effect";
import { Miniflare } from "miniflare";

import type { CalendarEnvironment } from "../server/calendar-environment.js";
import { desktopRoutes } from "../server/desktop-routes.js";
import { calendarLiveClient } from "../server/live-client.js";
import {
  bundleCalendarWorker,
  workerModuleHash,
  WorkerArtifactMismatch,
} from "./bundle-worker.js";
import type { WorkerArtifact } from "./bundle-worker.js";
import { fakeCalendarGoogle } from "./calendar-google.js";
import type { FakeConferenceOutcome } from "./calendar-google.js";
import { seedFakePerson } from "./person.js";

const Watch = Schema.Struct({
  address: Schema.String,
  id: Schema.String,
  token: Schema.String,
});

const Method = Schema.Literals(["GET", "POST", "PATCH", "DELETE"]);

const emptyFailure = () => new Response(null, { status: 503 });

const fakeUserInfoRequest = (url: URL) =>
  url.hostname === "openidconnect.googleapis.com" &&
  url.pathname === "/v1/userinfo";

const fakeProviderRequest = (url: URL) =>
  fakeUserInfoRequest(url) ||
  (url.hostname === "www.googleapis.com" &&
    url.pathname.startsWith("/calendar/v3/"));

export const makeNativeDevelopmentRuntime = Effect.fn(
  "makeNativeDevelopmentRuntime"
)(function* makeNativeDevelopmentRuntime(
  origin: string,
  emails?: readonly string[],
  conferenceOutcome: typeof FakeConferenceOutcome.Type = "success",
  artifact?: WorkerArtifact
) {
  const run = Effect.runPromiseWith(yield* Effect.context());

  const modules =
    artifact === undefined
      ? yield* bundleCalendarWorker(
          new URL("live-worker.ts", import.meta.url).pathname
        )
      : artifact.modules.map((module) => ({ ...module }));

  if (artifact !== undefined) {
    const actual = yield* workerModuleHash(modules);

    if (actual !== artifact.hash) {
      return yield* new WorkerArtifactMismatch({
        actual,
        expected: artifact.hash,
      });
    }
  }

  const provider = makeFakeGoogle(origin);

  const config = {
    allowedEmails: "joel@example.test,second@example.test",
    baseURL: origin,
    clientId: "calendar-local",
    clientSecret: "local-only-client-secret",
    secret: "calendar-development-only-signing-key-not-for-production",
    tokenEndpoint: `${origin}/__fake-google/token`,
  };

  const accounts = ["joel@example.test", "second@example.test"].map(
    (email) => ({ email, id: email })
  );

  const googleLayer = yield* fakeCalendarGoogle(accounts, conferenceOutcome);
  const googleContext = yield* Layer.build(googleLayer);
  const google = yield* GoogleHttp.pipe(Effect.provideContext(googleContext));

  const channels = new Map<
    string,
    {
      readonly address: string;
      readonly token: string;
      readonly resourceId: string;
      readonly path: string;
      readonly email: string;
      number: number;
    }
  >();

  const channelStops: {
    readonly id: string;
    readonly resourceId: string | undefined;
    readonly email: string;
  }[] = [];

  const refusedChannelStops = new Set<string>();

  const outboundRequests: {
    readonly hostname: string;
    readonly method: string;
    readonly path: string;
    readonly showHidden: string | null;
    readonly colorRgbFormat: string | null;
  }[] = [];

  // @effect-diagnostics-next-line asyncFunction:off -- Miniflare invokes the fake outbound provider through a native Web Request Promise boundary.
  const outbound = async (request: Request): Promise<Response> =>
    await run(
      Effect.gen(function* fakeOutbound() {
        const url = new URL(request.url);
        outboundRequests.push({
          colorRgbFormat: url.searchParams.get("colorRgbFormat"),
          hostname: url.hostname,
          method: request.method,
          path: url.pathname,
          showHidden: url.searchParams.get("showHidden"),
        });

        if (outboundRequests.length > 512) {
          outboundRequests.shift();
        }

        if (url.pathname.endsWith("/token")) {
          const body = new URLSearchParams(
            yield* Effect.promise(request.text.bind(request))
          );

          const refreshed = provider.refresh(body.get("refresh_token") ?? "");

          return Response.json(refreshed ?? { error: "invalid_grant" }, {
            status: refreshed === null ? 400 : 200,
          });
        }

        const userInfo = fakeUserInfoRequest(url);

        if (!fakeProviderRequest(url)) {
          return emptyFailure();
        }

        const bearer =
          request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";

        const identity = yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Native Promise adapter failed"),

          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => provider.provider.userInfo(bearer),
        });

        if (userInfo) {
          return Response.json({
            email: identity.email,
            email_verified: identity.emailVerified,
            name: identity.name,
            sub: identity.id,
          });
        }

        const path = url.pathname.slice("/calendar/v3".length);

        const body =
          request.method === "GET"
            ? undefined
            : yield* Effect.promise(request.text.bind(request));

        if (path.endsWith("/watch") && request.method === "POST") {
          const channel = yield* Schema.decodeEffect(
            Schema.fromJsonString(Watch)
          )(body ?? "");

          const resourceId = `local-resource-${channel.id}`;
          channels.set(channel.id, {
            ...channel,
            email: identity.email,
            number: 1,
            path,
            resourceId,
          });

          return Response.json({
            expiration: String((yield* Clock.currentTimeMillis) + 604_800_000),
            id: channel.id,
            resourceId,
          });
        }

        if (path === "/channels/stop" && request.method === "POST") {
          const stop = yield* Schema.decodeEffect(
            Schema.fromJsonString(
              Schema.Struct({
                id: Schema.String,
                resourceId: Schema.optionalKey(Schema.String),
              })
            )
          )(body ?? "");

          channelStops.push({
            email: identity.email,
            id: stop.id,
            resourceId: stop.resourceId,
          });

          if (refusedChannelStops.has(stop.id)) {
            return Response.json(
              { error: { message: "Local channel stop refused" } },
              { status: 503 }
            );
          }

          channels.delete(stop.id);

          return new Response(null, { status: 204 });
        }

        const input: GoogleRequestValue = {
          accountId: identity.email,
          method: yield* Schema.decodeUnknownEffect(Method)(request.method),
          path: `${path}${url.search}`,
        };

        const response = yield* google.execute(
          body === undefined ? input : { ...input, body },
          bearer
        );

        return new Response(response.status === 204 ? null : response.body, {
          headers: { "content-type": "application/json" },
          status: response.status,
        });
      }).pipe(Effect.orElseSucceed(emptyFailure))
    );

  const miniflare = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new Miniflare({
          bindings: {
            ALLOWED_EMAILS: config.allowedEmails,
            BETTER_AUTH_SECRET: config.secret,
            CALENDAR_ORIGIN: origin,
            GOOGLE_CLIENT_ID: config.clientId,
            GOOGLE_CLIENT_SECRET: config.clientSecret,
            RELEASE: "development",
          },
          compatibilityDate: "2026-07-30",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "calendar-development" },
          durableObjects: {
            CALENDAR_LIVE: { className: "CalendarLive", useSQLite: true },
          },
          host: "127.0.0.1",
          modules,
          modulesRoot: "/calendar",
          name: "calendar-development",
          outboundService: outbound,
          serviceBindings: {
            ASSETS: () => new Response("Development assets are served by Vite"),
          },
          upstream: origin,
        })
    ),
    (instance) => Effect.promise(instance.dispose.bind(instance))
  );

  const database = yield* Effect.tryPromise({
    catch: (cause) =>
      new Cause.UnknownError(cause, "Native Promise adapter failed"),

    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
    try: () => miniflare.getD1Database("DB"),
  }).pipe(Effect.orDie);

  for (const file of [
    "0001_auth.sql",
    "0002_calendar_cache.sql",
    "0003_google_push.sql",
    "0004_settings_disconnect.sql",
    "0005_settings_disconnect_fences.sql",
    "0006_conferencing_default.sql",
    "0007_push_unsupported.sql",
    "0008_verification_owner_fence.sql",
    "0009_primary_calendar_account.sql",
    "0010_custom_video_links.sql",
  ]) {
    const sql = yield* Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(cause, "Native Promise adapter failed"),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        readFile(
          new URL(
            `../../../../packages/database/migrations/calendar/${file}`,
            import.meta.url
          ),
          "utf-8"
        ),
    });

    const statements = sql
      .split(
        file === "0005_settings_disconnect_fences.sql" ||
          file === "0008_verification_owner_fence.sql"
          ? "\n"
          : ";"
      )
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => database.prepare(statement));

    yield* Effect.promise(database.batch.bind(database, statements));
  }

  const bindings = yield* Effect.tryPromise({
    catch: (cause) =>
      new Cause.UnknownError(cause, "Native Promise adapter failed"),

    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
    try: () => miniflare.getBindings<CalendarEnvironment>(),
  }).pipe(Effect.orDie);

  const live = calendarLiveClient(bindings.CALENDAR_LIVE);

  const auth = createGoogleAuth(
    {
      ...config,
      // @effect-diagnostics-next-line asyncFunction:off -- Better Auth invokes account cleanup through a native Promise callback.
      beforeAccountDelete: async (personId, accountId) => {
        await run(live.stopAccount(personId, accountId));
      },
    },
    database,
    provider.provider
  );

  const fake = { ...provider, auth, config, provider: provider.provider };
  const person = yield* seedFakePerson(fake, emails);

  const ready = yield* Effect.tryPromise({
    catch: (cause) =>
      new Cause.UnknownError(cause, "Native Promise adapter failed"),

    // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
    try: () => miniflare.ready,
  }).pipe(Effect.orDie);

  let bootstrapped = false;

  // @effect-diagnostics-next-line asyncFunction:off -- Vite forwards Web Requests through this native Promise boundary.
  const handle = async (request: Request): Promise<Response> =>
    await run(
      Effect.gen(function* developmentRequest() {
        const url = new URL(request.url);

        if (url.pathname.startsWith("/desktop/")) {
          return yield* Effect.promise(
            desktopRoutes.bind(
              undefined,
              request,
              config,
              database,
              provider.provider
            )
          );
        }

        if (url.pathname === "/__fake-google/authorize") {
          const email = url.searchParams.get("email");

          if (email !== null) {
            return Response.redirect(provider.authorize(url, email), 302);
          }

          return new Response(
            `<!doctype html><html lang="en"><meta charset="utf-8"><title>Local Google</title><h1>Development Google account</h1><p>No Google connection is made.</p><form method="get"><select name="email"><option>joel@example.test</option><option>second@example.test</option><option>refused@example.test</option></select><button>Continue</button></form><script>for(const [name,value] of new URLSearchParams(location.search)){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;document.querySelector('form').append(input)}</script></html>`,
            { headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }

        if (url.pathname === "/__fake-google/token") {
          return yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(cause, "Native Promise adapter failed"),

            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () => outbound(request),
          }).pipe(Effect.orDie);
        }

        if (url.pathname.startsWith("/auth/")) {
          return yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(cause, "Native Promise adapter failed"),

            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () => auth.handler(request),
          }).pipe(Effect.orDie);
        }

        if (
          url.pathname === "/__fake-google/change" &&
          request.method === "POST"
        ) {
          const input = yield* Schema.decodeEffect(
            Schema.fromJsonString(
              Schema.Struct({
                calendarId: Schema.String,
                email: Schema.Literals([
                  "joel@example.test",
                  "second@example.test",
                ]),
                eventId: Schema.String,
                summary: Schema.String,
              })
            )
          )(yield* Effect.promise(request.text.bind(request)));

          const patched = yield* google.execute(
            {
              accountId: input.email,
              body: JSON.stringify({ summary: input.summary }),
              method: "PATCH",
              path: `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
            },
            "fixture"
          );

          let delivered = 0;
          const statuses: number[] = [];

          if (patched.status !== 200) {
            return new Response(patched.body, { status: patched.status });
          }

          for (const [id, channel] of channels) {
            if (
              channel.email !== input.email ||
              !channel.path.startsWith(
                `/calendars/${encodeURIComponent(input.calendarId)}/`
              )
            ) {
              continue;
            }

            channel.number += 1;

            const response = yield* Effect.tryPromise({
              catch: (cause) =>
                new Cause.UnknownError(cause, "Native Promise adapter failed"),

              // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
              try: () =>
                miniflare.dispatchFetch(`${origin}/google/push`, {
                  headers: {
                    "x-goog-channel-id": id,
                    "x-goog-channel-token": channel.token,
                    "x-goog-message-number": String(channel.number),
                    "x-goog-resource-id": channel.resourceId,
                    "x-goog-resource-state": "exists",
                  },
                  method: "POST",
                }),
            }).pipe(Effect.orDie);

            statuses.push(response.status);

            if (response.status === 200) {
              delivered += 1;
            }
          }

          return Response.json({ delivered, statuses });
        }

        const headers = new Headers(request.headers);

        const bootstrap =
          !bootstrapped && url.pathname === "/rpc" && !headers.has("cookie");

        if (bootstrap) {
          headers.set("cookie", person.cookie);
          bootstrapped = true;
        }

        const body =
          request.method === "GET" || request.method === "HEAD"
            ? null
            : yield* Effect.promise(request.text.bind(request));

        const response = yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Native Promise adapter failed"),

          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () =>
            miniflare.dispatchFetch(request.url, {
              body,
              headers: [...headers],
              method: request.method,
            }),
        }).pipe(Effect.orDie);

        const resultHeaders = new Headers([...response.headers]);

        if (bootstrap) {
          for (const cookie of person.cookie.split("; ")) {
            resultHeaders.append(
              "set-cookie",
              `${cookie}; HttpOnly; SameSite=Lax; Path=/`
            );
          }
        }

        return new Response(
          yield* Effect.promise(response.arrayBuffer.bind(response)),
          { headers: resultHeaders, status: response.status }
        );
      })
    );

  return {
    channelStops,
    database,
    handle,
    hashWorker: () => workerModuleHash(modules),
    linkAccount: (email: string, cookie: string) =>
      seedFakePerson(fake, [email], { cookie }),
    miniflare,
    notifyChannel: Effect.fn("development.notifyChannel")(
      function* notifyChannel(id: string) {
        const channel = channels.get(id);

        if (channel === undefined) {
          return yield* Effect.die(
            new Error("The fake notification channel does not exist")
          );
        }

        channel.number += 1;

        const response = yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Local provider notification failed"),
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () =>
            miniflare.dispatchFetch(channel.address, {
              headers: {
                "x-goog-channel-id": id,
                "x-goog-channel-token": channel.token,
                "x-goog-message-number": String(channel.number),
                "x-goog-resource-id": channel.resourceId,
                "x-goog-resource-state": "exists",
              },
              method: "POST",
            }),
        });

        return response.status;
      }
    ),
    origin,
    outboundRequests,
    person,
    providerChannels: () =>
      [...channels].map(([id, channel]) => ({
        email: channel.email,
        id,
        resourceId: channel.resourceId,
      })),
    refuseChannelStop: (id: string) =>
      Effect.sync(() => {
        refusedChannelStops.add(id);
      }),
    seedPerson: (identities: readonly string[]) =>
      seedFakePerson(fake, identities),
    url: ready,
  };
});

export class DevelopmentRuntime extends Context.Service<
  DevelopmentRuntime,
  Effect.Success<ReturnType<typeof makeNativeDevelopmentRuntime>>
>()("@calendar/web/DevelopmentRuntime") {
  static layer(
    origin: string,
    emails?: readonly string[],
    conferenceOutcome: typeof FakeConferenceOutcome.Type = "success",
    artifact?: WorkerArtifact
  ) {
    return Layer.effect(
      this,
      makeNativeDevelopmentRuntime(origin, emails, conferenceOutcome, artifact)
    );
  }
}
