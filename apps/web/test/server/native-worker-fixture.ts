import { Cause, Effect } from "effect";
import { Miniflare } from "miniflare";

import { bundleCalendarWorker } from "../../src/dev/bundle-worker.js";
import {
  authMigration,
  calendarMigration,
  conferencingMigration,
  pushMigration,
  settingsMigration,
  settingsFenceMigration,
} from "./d1-fixture.js";

export const nativeWorkerFixture = Effect.fn("test.nativeWorkerFixture")(
  function* nativeWorkerFixture(
    origin?: string,
    outboundService?: (request: Request) => Response | Promise<Response>
  ) {
    const entry: string = new URL("../../src/server/worker.ts", import.meta.url)
      .pathname;

    const modules = yield* bundleCalendarWorker(entry);

    const miniflare = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new Miniflare({
            bindings: {
              ALLOWED_EMAILS: "joel@example.test,second@example.test",
              BETTER_AUTH_SECRET:
                "fixture-only-secret-at-least-thirty-two-characters",
              CALENDAR_ORIGIN: origin ?? "https://calendar.wzrrd.sh",
              GOOGLE_CLIENT_ID: "fixture-client",
              GOOGLE_CLIENT_SECRET: "fixture-client-secret",
              RELEASE: "fixture-release",
            },
            compatibilityDate: "2026-07-30",
            compatibilityFlags: ["nodejs_compat"],
            d1Databases: { DB: "calendar-native-test" },
            durableObjects: {
              CALENDAR_LIVE: { className: "CalendarLive", useSQLite: true },
            },
            host: "127.0.0.1",
            modules,
            modulesRoot: "/calendar",
            outboundService:
              outboundService ??
              (() =>
                new Response("Outbound network is disabled", { status: 503 })),
            serviceBindings: {
              ASSETS: (request: Request) => {
                const path = new URL(request.url).pathname;

                return path === "/" || path.startsWith("/assets/")
                  ? new Response("fixture")
                  : new Response("Missing asset", { status: 404 });
              },
            },
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

    const statements = [
      ...[
        authMigration,
        calendarMigration,
        pushMigration,
        settingsMigration,
        conferencingMigration,
      ]
        .join("\n")
        .split(";"),
      ...settingsFenceMigration.split("\n"),
    ].flatMap((statement) => {
      const sql = statement.trim();

      return sql === "" ? [] : [database.prepare(sql)];
    });

    yield* Effect.promise(database.batch.bind(database, statements));

    return { database, miniflare };
  }
);
