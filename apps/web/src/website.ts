import { fileURLToPath } from "node:url";

import { readReleaseManifest } from "@calendar/core/release";
import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import { Config, Effect } from "effect";

export const calendarDomain = "calendar.wzrrd.sh";

export const websiteRelease = readReleaseManifest(
  fileURLToPath(new URL("../dist/client/release.json", import.meta.url))
);

export const calendarWebsite = Effect.gen(function* calendarWebsite() {
  const database = yield* Cloudflare.D1.Database("CalendarData", {
    migrations: "../../packages/database/migrations/calendar",
  }).pipe(retain());

  const release = yield* websiteRelease.pipe(Effect.orDie);

  return yield* Cloudflare.Website.Foldkit("CalendarWorker", {
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: true,
    },
    crons: ["*/15 * * * *"],
    domain: { name: calendarDomain, zoneName: "wzrrd.sh" },
    env: {
      ALLOWED_EMAILS: Config.String("ALLOWED_EMAILS"),
      BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
      CALENDAR_LIVE: Cloudflare.DurableObject("CalendarLive", {
        className: "CalendarLive",
      }),
      CALENDAR_ORIGIN: `https://${calendarDomain}`,
      DB: database,
      GOOGLE_CLIENT_ID: Config.String("GOOGLE_CLIENT_ID"),
      GOOGLE_CLIENT_SECRET: Config.Redacted("GOOGLE_CLIENT_SECRET"),
      RELEASE: release.generation,
    },
    main: "src/server/worker.ts",
    rootDir: "../web",
    routes: [{ pattern: "calendar.wzrrd.sh/*", zoneName: "wzrrd.sh" }],
    workersDev: false,
  });
});
