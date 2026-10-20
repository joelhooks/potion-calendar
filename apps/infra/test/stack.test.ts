import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { AuthProviders, Stage } from "alchemy";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { HttpClient } from "effect/http";

import { deploymentRelease } from "../../../packages/deploy/src/local.js";
import { releaseFingerprint } from "../../web/release.js";
import { websiteRelease } from "../../web/src/website.js";
import stack from "../alchemy.run.js";

const services = Layer.mergeAll(
  AlchemyContextLive.pipe(Layer.provideMerge(NodeServices.layer)),
  Layer.succeed(Stage, "CalendarProd"),
  Layer.succeed(AuthProviders, {}),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() =>
      Effect.die("A Stack declaration must not contact Cloudflare")
    )
  )
);

it.effect(
  "the actual Stack owns one Worker and D1, with no Zone or standalone DNS resource",
  () =>
    Effect.gen(function* calendarFootprint() {
      const compiled = yield* stack;
      const resources = Object.values(compiled.resources);

      const workers = resources.filter(
        (resource) => resource.Type === "Cloudflare.Worker"
      );

      const databases = resources.filter(
        (resource) => resource.Type === "Cloudflare.D1Database"
      );

      expect(workers).toHaveLength(1);
      expect(databases).toHaveLength(1);
      expect(
        resources.some(
          (resource) =>
            resource.Type.includes("Zone") ||
            resource.Type.includes("DNS") ||
            resource.Type.includes("Email")
        )
      ).toBe(false);
      expect(
        resources.every((resource) => resource.LogicalId.startsWith("Calendar"))
      ).toBe(true);
      expect(databases[0]?.RemovalPolicy).toBe("retain");

      const props = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          domain: Schema.Struct({
            name: Schema.String,
            zoneName: Schema.String,
          }),
          env: Schema.Struct({
            CALENDAR_LIVE: Schema.Struct({
              className: Schema.String,
              kind: Schema.String,
            }),
            CALENDAR_ORIGIN: Schema.String,
            RELEASE: Schema.String,
          }),
          routes: Schema.Array(
            Schema.Struct({ pattern: Schema.String, zoneName: Schema.String })
          ),
          workersDev: Schema.Boolean,
        })
      )(workers[0]?.Props);

      expect(props.domain).toEqual({
        name: "calendar.wzrrd.sh",
        zoneName: "wzrrd.sh",
      });
      expect(props.routes).toEqual([
        { pattern: "calendar.wzrrd.sh/*", zoneName: "wzrrd.sh" },
      ]);
      expect(props.workersDev).toBe(false);
      expect(props.env.CALENDAR_ORIGIN).toBe(`https://${props.domain.name}`);
      expect(props.env.CALENDAR_LIVE).toEqual({
        className: "CalendarLive",
        kind: "Cloudflare.DurableObject",
      });
      expect(props.env.RELEASE).toBe((yield* websiteRelease).generation);
    }).pipe(
      Effect.provide(services),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({
          ALLOWED_EMAILS: "fixture@example.test",
          BETTER_AUTH_SECRET: "fixture-only-auth-signing-key-32-characters",
          GOOGLE_CLIENT_ID: "fixture-client",
          GOOGLE_CLIENT_SECRET: "fixture-only-client-secret",
        })
      )
    )
);

it.effect(
  "the producer, deploy driver, and Worker binding read the same source-hash marker",
  () =>
    Effect.gen(function* releaseMarkerSeam() {
      const computed = yield* releaseFingerprint;
      const deployed = yield* deploymentRelease;
      const website = yield* websiteRelease;

      expect(deployed.generation).toBe(computed);
      expect(website.generation).toBe(computed);
    }).pipe(Effect.provide(NodeServices.layer))
);
