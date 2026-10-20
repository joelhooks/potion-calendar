import { Approval } from "@calendar/capability/approval";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";

import { localLayer } from "../src/local.js";
import { runDeploy } from "../src/machine.js";

it.effect(
  "empty production configuration stops the real driver before planning and reports names only",
  () =>
    Effect.gen(function* test() {
      const requests: string[] = [];

      const client = HttpClient.make((request) => {
        requests.push(request.url);

        return Effect.die("missing-inputs-must-stop-before-provider-read");
      });

      const services = localLayer(
        "unreachable-stack.ts",
        new URL("../../../.env.schema", import.meta.url).pathname,
        "https://example.test"
      ).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            NodeServices.layer,
            ConfigProvider.layer(ConfigProvider.fromUnknown({})),
            Layer.succeed(HttpClient.HttpClient, client),
            Approval.denyAll
          )
        )
      );

      const verdict = yield* runDeploy({
        allow: [],
        mode: "plan",
        profile: "test-profile",
      }).pipe(Effect.provide(services));

      expect(verdict.outcome).toBe("refused");
      expect(verdict.step).toBe("preflight");
      expect(verdict.keys).toStrictEqual([
        "ALCHEMY_PROFILE",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "BETTER_AUTH_SECRET",
        "ALLOWED_EMAILS",
      ]);
      expect(verdict.rows).toStrictEqual([]);
      expect(requests).toStrictEqual([]);
    })
);
