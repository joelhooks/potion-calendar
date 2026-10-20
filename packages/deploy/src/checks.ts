import { toRpcGroup } from "@calendar/capability/rpc-group";
import { gateOutcome, runCheck } from "@calendar/check-harness";
import type { Verdict } from "@calendar/check-harness";
import { sessionContract } from "@calendar/core/contracts";
import { Clock, Config, Effect, Layer, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { RpcClient, RpcSerialization } from "effect/rpc";

import { DeployStepError } from "./contracts.js";

const okStatusClient = Layer.effect(
  HttpClient.HttpClient,
  HttpClient.HttpClient.pipe(Effect.map(HttpClient.filterStatusOk))
);

export const measuredCheck = <E, R>(
  check: string,
  work: Effect.Effect<boolean, E, R>
) =>
  runCheck(
    check,
    Effect.gen(function* measureBehavior() {
      const passed = yield* work;

      return {
        check,
        control: 1,
        counts: { observed: 1 },
        observedAt: yield* Clock.currentTimeMillis,
        reason: passed ? "behavior-confirmed" : "behavior-mismatch",
        ...(passed
          ? { exitCode: 0, outcome: "passed", status: "green" }
          : { exitCode: 2, outcome: "failed", status: "red" }),
      } satisfies Verdict;
    })
  );

export const contentVersionCheck = Effect.fn("contentVersionCheck")(
  function* contentVersionCheck(
    base: string,
    route: string,
    generation: string
  ) {
    const client = yield* HttpClient.HttpClient;
    const observedAt = yield* Clock.currentTimeMillis;
    const url = `${base}${route}?__rat_version=${encodeURIComponent(generation)}&__rat_probe=${observedAt}`;

    return yield* runCheck(
      `content-version:${route}`,
      Effect.gen(function* observeContentVersion() {
        const response = yield* client.execute(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setHeaders({
              accept: "text/markdown",
              "accept-encoding": "identity",
            })
          )
        );

        const { etag } = response.headers;

        const evidence = {
          check: `content-version:${route}`,
          counts: { observed: 1 },
          deploymentVersion: generation,
          observedAt,
          provenance: [
            {
              fetchedAt: observedAt,
              id: route,
              source: url,
              status: `http=${response.status};etag=${etag ?? "missing"}`,
            },
          ],
        };

        if (etag === undefined || etag.trim().length === 0) {
          return {
            ...evidence,
            control: 0,
            exitCode: 3,
            outcome: "errored",
            reason: "content-version-header-missing",
            status: "hold",
          } satisfies Verdict;
        }

        const passed =
          response.status === 200 &&
          etag.replace(/^W\//u, "") ===
            `"${generation}:default:${encodeURIComponent(route)}"`;

        return {
          ...evidence,
          control: 1,
          reason: passed
            ? "content-version-confirmed"
            : "content-version-mismatch",
          resourceVersion: etag,
          ...(passed
            ? { exitCode: 0, outcome: "passed", status: "green" }
            : { exitCode: 2, outcome: "failed", status: "red" }),
        } satisfies Verdict;
      })
    );
  }
);

export const htmlContentVersionCheck = Effect.fn("htmlContentVersionCheck")(
  function* htmlContentVersionCheck(
    base: string,
    route: string,
    generation: string
  ) {
    const client = yield* HttpClient.HttpClient;
    const observedAt = yield* Clock.currentTimeMillis;
    const url = `${base}${route}?__rat_version=${encodeURIComponent(generation)}&__rat_probe=${observedAt}`;

    return yield* runCheck(
      `html-content-version:${route}`,
      Effect.gen(function* observeHtmlContentVersion() {
        const response = yield* client.execute(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setHeaders({
              accept: "text/html",
              "accept-encoding": "identity",
            })
          )
        );

        const served = response.headers["x-content-generation"];

        const evidence = {
          check: `html-content-version:${route}`,
          counts: { observed: 1 },
          deploymentVersion: generation,
          observedAt,
          provenance: [
            {
              fetchedAt: observedAt,
              id: route,
              source: url,
              status: `http=${response.status};generation=${served ?? "missing"}`,
            },
          ],
        };

        if (served === undefined || served.trim().length === 0) {
          return {
            ...evidence,
            control: 0,
            exitCode: 3,
            outcome: "errored",
            reason: "html-content-generation-header-missing",
            status: "hold",
          } satisfies Verdict;
        }

        const passed = response.status === 200 && served.trim() === generation;

        return {
          ...evidence,
          control: 1,
          reason: passed
            ? "content-version-confirmed"
            : "content-version-mismatch",
          resourceVersion: served,
          ...(passed
            ? { exitCode: 0, outcome: "passed", status: "green" }
            : { exitCode: 2, outcome: "failed", status: "red" }),
        } satisfies Verdict;
      })
    );
  }
);

export const contentVersionRetryDefaults = {
  deadlineMs: 120_000,
  initialDelayMs: 1000,
  maximumDelayMs: 10_000,
};

export const settledContentVersionCheck = Effect.fn(
  "settledContentVersionCheck"
)(function* settledContentVersionCheck<E, R>(
  work: Effect.Effect<Verdict, E, R>,
  options = contentVersionRetryDefaults
) {
  const startedAt = yield* Clock.currentTimeMillis;
  const attempts: Verdict[] = [];

  for (;;) {
    const remaining = Math.max(
      0,
      options.deadlineMs - ((yield* Clock.currentTimeMillis) - startedAt)
    );

    const verdict = yield* runCheck(
      "content-version",
      work.pipe(Effect.timeout(Math.max(1, remaining)))
    );

    attempts.push(verdict);
    const elapsed = (yield* Clock.currentTimeMillis) - startedAt;

    if (
      gateOutcome(verdict) === "pass" ||
      verdict.reason !== "content-version-mismatch" ||
      elapsed >= options.deadlineMs
    ) {
      return {
        ...verdict,
        counts: {
          ...verdict.counts,
          attempts: attempts.length,
          deadlineMs: options.deadlineMs,
          durationMs: elapsed,
          failedAttempts: attempts.filter((row) => gateOutcome(row) !== "pass")
            .length,
        },
        provenance: attempts.flatMap((row, index) => [
          {
            fetchedAt: row.observedAt,
            id: `content-attempt:${index + 1}`,
            source: "content-version-check",
            status: `${row.status}:${row.reason}`,
          },
          ...(row.provenance ?? []),
        ]),
      } satisfies Verdict;
    }

    const delay = Math.min(
      options.maximumDelayMs,
      options.initialDelayMs * 2 ** Math.min(attempts.length - 1, 20),
      options.deadlineMs - elapsed
    );

    yield* Effect.sleep(delay);
  }
});

export const rpcSessionCheck = (url: string) =>
  measuredCheck(
    "rpc-anonymous-session",
    Effect.gen(function* anonymousSession() {
      const rpc = yield* RpcClient.make(toRpcGroup([sessionContract]).group);

      return (yield* rpc.session({})) === null;
    }).pipe(
      Effect.provide(
        RpcClient.layerProtocolHttp({ url: `${url}/rpc` }).pipe(
          Layer.provide([RpcSerialization.layerJson, okStatusClient])
        )
      ),
      Effect.scoped
    )
  );

export const postDeployChecks = Effect.fn("postDeployChecks")(
  function* postDeployChecks(
    base: string,
    contentGeneration: string,
    _appliedAt: number,
    contentRetry?: typeof contentVersionRetryDefaults
  ) {
    const retry = contentRetry ?? {
      ...contentVersionRetryDefaults,
      deadlineMs: yield* Config.Int("DEPLOY_CONTENT_VERSION_DEADLINE_MS").pipe(
        Config.withDefault(contentVersionRetryDefaults.deadlineMs)
      ),
    };

    yield* Schema.decodeEffect(
      Schema.Int.check(Schema.isBetween({ maximum: 600_000, minimum: 0 }))
    )(retry.deadlineMs);
    const client = yield* HttpClient.HttpClient;
    const url = base.replace(/\/$/u, "");

    const checks = [
      yield* settledContentVersionCheck(
        htmlContentVersionCheck(url, "/", contentGeneration),
        retry
      ),
      yield* rpcSessionCheck(url),
    ];

    for (const [route, status] of [
      ["/refused", 403],
      ["/__fake-google/authorize", 404],
      ["/mcp", 404],
      ["/news", 404],
    ] as const) {
      checks.push(
        yield* measuredCheck(
          `route:${route}`,
          client
            .get(`${url}${route}`)
            .pipe(Effect.map((response) => response.status === status))
        )
      );
    }

    return checks;
  },
  Effect.mapError(
    () =>
      new DeployStepError({
        keys: ["DEPLOY_CONTENT_VERSION_DEADLINE_MS"],
        reason: "release-version-retry-input-invalid",
        step: "checks",
      })
  ),
  Effect.scoped
);
