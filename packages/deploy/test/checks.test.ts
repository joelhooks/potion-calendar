import { toRpcGroup } from "@calendar/capability/rpc-group";
import { gateOutcome } from "@calendar/check-harness";
import { sessionContract } from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Match, Predicate, Schema } from "effect";
import {
  HttpClient,
  HttpClientResponse,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { postDeployChecks } from "../src/checks.js";

const { group } = toRpcGroup([sessionContract]);

const probeOrigins = {
  default: {
    base: "https://calendar.example.test",
    origin: "https://calendar.example.test",
  },
  explicitDefault: {
    base: "https://calendar.example.test:443",
    origin: "https://calendar.example.test",
  },
  nonDefault: {
    base: "https://calendar.example.test:8443",
    origin: "https://calendar.example.test:8443",
  },
};

it.effect.prop(
  "release health requires matching HTML, anonymous RPC isolation, and every privacy boundary",
  {
    brokenRoute: Schema.Boolean,
    leaksSession: Schema.Boolean,
    matchesRelease: Schema.Boolean,
    originVariant: Schema.Literals([
      "default",
      "explicitDefault",
      "nonDefault",
    ]),
  },
  ({ brokenRoute, leaksSession, matchesRelease, originVariant }) =>
    Effect.gen(function* releaseHealth() {
      const rpc = yield* RpcServer.toHttpEffect(group).pipe(
        Effect.provide(
          Layer.mergeAll(
            group.toLayer({
              session: () =>
                Effect.succeed(
                  leaksSession
                    ? {
                        accounts: [],
                        user: {
                          email: "fixture@example.test",
                          id: "fixture-person",
                          name: "Fixture",
                        },
                      }
                    : null
                ),
            }),
            RpcSerialization.layerJson
          )
        )
      );

      const { base, origin } = probeOrigins[originVariant];
      const requests: string[] = [];

      const rpcHeaders: {
        readonly origin: string | undefined;
        readonly site: string | undefined;
      }[] = [];

      const otherHeaders: {
        readonly origin: string | undefined;
        readonly site: string | undefined;
      }[] = [];

      const client = HttpClient.make((request) => {
        requests.push(request.url);
        const path = new URL(request.url).pathname;

        const admission = {
          origin: request.headers.origin,
          site: request.headers["sec-fetch-site"],
        };

        if (path === "/rpc" || path === "/rpc/") {
          rpcHeaders.push(admission);

          if (admission.origin !== origin || admission.site !== "same-origin") {
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(null, { status: 403 })
              )
            );
          }

          const body = Predicate.isTagged(request.body, "Uint8Array")
            ? new TextDecoder().decode(request.body.body)
            : "";

          return rpc.pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              HttpServerRequest.fromWeb(
                new Request(request.url, {
                  body,
                  headers: request.headers,
                  method: request.method,
                })
              )
            ),
            Effect.scoped,
            Effect.map((response) =>
              HttpClientResponse.fromWeb(
                request,
                HttpServerResponse.toWeb(response)
              )
            )
          );
        }

        otherHeaders.push(admission);

        const status = Match.value(path).pipe(
          Match.when("/", () => 200),
          Match.when("/refused", () => 403),
          Match.orElse(() => 404)
        );

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("Calendar", {
              headers: {
                "x-content-generation": matchesRelease
                  ? "test-release"
                  : "previous-release",
              },
              status:
                brokenRoute && path === "/__fake-google/authorize"
                  ? 200
                  : status,
            })
          )
        );
      });

      const checks = yield* postDeployChecks(base, "test-release", 0, {
        deadlineMs: 0,
        initialDelayMs: 1,
        maximumDelayMs: 1,
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      expect(
        checks.every((check) => gateOutcome(check) === "pass"),
        JSON.stringify(checks)
      ).toBe(matchesRelease && !leaksSession && !brokenRoute);
      expect(
        requests.every(
          (url) => new URL(url).hostname === "calendar.example.test"
        )
      ).toBe(true);
      expect(rpcHeaders).toEqual([{ origin, site: "same-origin" }]);
      expect(otherHeaders.length).toBeGreaterThan(0);
      expect(
        otherHeaders.every(
          (headers) =>
            headers.origin === undefined && headers.site === undefined
        )
      ).toBe(true);
    }),
  { arbitrary: { runs: 50 } }
);
