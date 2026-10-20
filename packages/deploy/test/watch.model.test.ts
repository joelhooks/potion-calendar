import { expect, it } from "@effect/vitest";
import { Effect, Fiber, References, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";

import {
  nextWatchEvidence,
  printableBody,
  watchDeployment,
  watchVerdict,
} from "../src/watch.js";
import type { WatchEvidence } from "../src/watch.js";

const ProbeStatus = Schema.Literals([0, 200, 404, 500, 503]);

const Cycle = Schema.Struct({
  shellAny: ProbeStatus,
  shellHtml: ProbeStatus,
});

it.effect.prop(
  "only adjacent cycles with a shell 500 accumulate the failure threshold",
  { history: Schema.Array(Cycle).check(Schema.isMaxLength(30)) },
  ({ history }) =>
    Effect.sync(() => {
      let evidence: WatchEvidence = {
        cycles: 0,
        observations: [],
        routes: ["/"],
        streak: 0,
      };

      let expected = 0;

      for (const [index, cycle] of history.entries()) {
        expected =
          cycle.shellAny === 500 || cycle.shellHtml === 500 ? expected + 1 : 0;
        evidence = nextWatchEvidence(evidence, [
          {
            accept: "*/*",
            body: `failure-${index}`,
            content: true,
            observedAt: index,
            route: "/",
            status: cycle.shellAny,
          },
          {
            accept: "text/html",
            body: `failure-${index}`,
            content: true,
            observedAt: index,
            route: "/",
            status: cycle.shellHtml,
          },
        ]);
        expect(evidence.streak).toBe(expected);
        expect(evidence.cycles).toBe(index + 1);
        expect(evidence.observations[0]?.body).toBe("failure-0");
        expect(evidence.observations).toHaveLength((index + 1) * 2);
      }
    }),
  { arbitrary: { runs: 100 } }
);

interface Request {
  readonly accept: string;
  readonly path: string;
}

const site = (
  statusFor: (path: string, accept: string) => number,
  requests: Request[],
  latencyMs = 0
) =>
  HttpClient.make((request) => {
    const path = new URL(request.url).pathname;
    const accept = request.headers.accept ?? "missing";
    requests.push({ accept, path });

    const status = path === "/" ? statusFor(path, accept) : 404;

    return Effect.as(
      Effect.sleep(latencyMs),
      HttpClientResponse.fromWeb(
        request,
        new Response(status === 200 ? "ok" : "x".repeat(10_000), {
          headers: { "cf-ray": "ray-first", "x-incident-id": "incident-first" },
          status,
        })
      )
    );
  });

it.effect.prop(
  "a healthy private app passes while only its shell is probed under both Accept headers",
  { cycles: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 1 })) },
  ({ cycles }) =>
    Effect.gen(function* healthyApp() {
      const requests: Request[] = [];

      const fiber = yield* watchDeployment(
        "https://example.test",
        cycles * 10,
        10
      ).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          site(() => 200, requests)
        ),
        Effect.provideService(References.MinimumLogLevel, "None"),
        Effect.forkChild
      );

      yield* TestClock.adjust((cycles + 1) * 10);
      const evidence = yield* Fiber.join(fiber);
      expect(evidence.cycles).toBe(cycles);

      for (const accept of ["*/*", "text/html"]) {
        expect(
          requests.filter(
            (request) => request.path === "/" && request.accept === accept
          )
        ).toHaveLength(cycles);
      }

      expect(evidence.routes).toEqual(["/"]);
      expect(evidence.observations).toHaveLength(cycles * 2);
      expect(requests).toHaveLength(cycles * 2);
    })
);

it.effect.prop(
  "any fixed-route 404 or 500 fails even under only one Accept header, with shell 500s stopping after two cycles",
  {
    accept: Schema.Literals(["*/*", "text/html"]),
    cycles: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 3 })),
    status: Schema.Literals([404, 500]),
  },
  ({ accept, status, cycles }) =>
    Effect.gen(function* failedApp() {
      const requests: Request[] = [];

      const client = site(
        (path, requestedAccept) =>
          path === "/" && requestedAccept === accept ? status : 200,
        requests
      );

      const fiber = yield* watchDeployment(
        "https://example.test",
        cycles * 10,
        10
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(References.MinimumLogLevel, "None"),
        Effect.flip,
        Effect.forkChild
      );

      yield* TestClock.adjust((cycles + 1) * 10);
      const failure = yield* Fiber.join(fiber);
      const streakFailure = status === 500;
      const expectedCycles = streakFailure ? 2 : cycles;
      expect(failure.reason).toBe(
        streakFailure
          ? "consecutive-content-500-cycles"
          : "non-200-or-incomplete-watch"
      );
      expect(failure.evidence.cycles).toBe(expectedCycles);
      expect(failure.evidence.streak).toBe(streakFailure ? 2 : 0);
      expect(requests).toHaveLength(expectedCycles * 2);

      const rejected = failure.evidence.observations.filter(
        (observation) => observation.status !== 200
      );

      expect(rejected).toHaveLength(expectedCycles);

      for (const observation of rejected) {
        expect(observation.route).toBe("/");
        expect(observation.accept).toBe(accept);
        expect(observation.status).toBe(status);
        expect(observation.incidentId).toBe("incident-first");
        expect(observation.cfRay).toBe("ray-first");
        expect(observation.body).toHaveLength(4096);
      }
    })
);

it.effect.prop(
  "the watch follows an independent deadline and streak model across changing response histories",
  {
    accept: Schema.Literals(["*/*", "text/html"]),
    history: Schema.Array(Schema.Literals([200, 404, 500, 503])).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(8)
    ),
  },
  ({ history, accept }) =>
    Effect.gen(function* responseHistory() {
      let expectedCycles = 0;
      let expectedStreak = 0;
      let expectedRejected = 0;

      for (const status of history) {
        expectedCycles += 1;
        expectedStreak = status === 500 ? expectedStreak + 1 : 0;
        expectedRejected += status === 200 ? 0 : 1;

        if (expectedStreak === 2) {
          break;
        }
      }

      const requests: Request[] = [];

      const client = site(
        (path, requestedAccept) =>
          path === "/" && requestedAccept === accept
            ? (history[Math.floor((requests.length - 1) / 2)] ?? 200)
            : 200,
        requests
      );

      const fiber = yield* watchDeployment(
        "https://example.test",
        history.length * 10,
        10
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(References.MinimumLogLevel, "None"),
        Effect.result,
        Effect.forkChild
      );

      yield* TestClock.adjust((history.length + 1) * 10);
      const result = yield* Fiber.join(fiber);

      const evidence = Result.isFailure(result)
        ? result.failure.evidence
        : result.success;

      expect(Result.isFailure(result)).toBe(expectedRejected > 0);
      expect(evidence.cycles).toBe(expectedCycles);
      expect(evidence.streak).toBe(expectedStreak);
      expect(
        evidence.observations.filter((row) => row.status !== 200)
      ).toHaveLength(expectedRejected);
      expect(requests).toHaveLength(expectedCycles * 2);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe(
          expectedStreak === 2
            ? "consecutive-content-500-cycles"
            : "non-200-or-incomplete-watch"
        );
      }
    })
);

it.effect(
  "an elapsed deadline cannot pass without a completed cycle or start any probe",
  () =>
    Effect.gen(function* expiredWatch() {
      const requests: Request[] = [];

      const failure = yield* watchDeployment(
        "https://example.test",
        0,
        10
      ).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          site(() => 200, requests)
        ),
        Effect.provideService(References.MinimumLogLevel, "None"),
        Effect.flip
      );

      expect(failure.reason).toBe("non-200-or-incomplete-watch");
      expect(failure.evidence.cycles).toBe(0);
      expect(failure.evidence.observations).toEqual([]);
      expect(requests).toEqual([]);
    })
);

it.effect(
  "a cycle finishing after the deadline cannot start another cycle",
  () =>
    Effect.gen(function* completedDeadline() {
      const requests: Request[] = [];

      const fiber = yield* watchDeployment("https://example.test", 5, 10).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          site(() => 200, requests, 10)
        ),
        Effect.forkChild
      );

      yield* TestClock.adjust(30);
      const evidence = yield* Fiber.join(fiber);
      expect(evidence.cycles).toBe(1);
      expect(requests).toHaveLength(2);
    })
);

const controlCodes = new Set([
  ...Array.from({ length: 32 }, (_, code) => code).filter(
    (code) => code !== 9 && code !== 10
  ),
  ...Array.from({ length: 33 }, (_, offset) => 127 + offset),
]);

const unprintable = {
  test: (text: string) =>
    Array.from(
      { length: text.length },
      (_, index) => text.codePointAt(index) ?? 0
    ).some((code) => controlCodes.has(code)),
};

it.prop(
  "a stored body never holds a control character other than newline or tab",
  {
    bytes: Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 255, minimum: 0 }))
    ).check(Schema.isMaxLength(64)),
  },
  ({ bytes }) => {
    const raw = new TextDecoder().decode(new Uint8Array(bytes));
    const body = printableBody(new Uint8Array(bytes));
    expect(unprintable.test(body)).toBe(false);
    expect(body === raw).toBe(!unprintable.test(raw));
  },
  { arbitrary: { runs: 500 } }
);

it.effect(
  "the watch verdict retains every rejected shell probe and only rejected probes",
  () =>
    Effect.gen(function* rejectedEvidence() {
      const requests: Request[] = [];

      const fiber = yield* watchVerdict("https://example.test").pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          site(
            (path, accept) => (path === "/" && accept === "*/*" ? 404 : 200),
            requests
          )
        ),
        Effect.provideService(References.MinimumLogLevel, "None"),
        Effect.forkChild
      );

      yield* TestClock.adjust(11 * 60_000);
      const verdict = yield* Fiber.join(fiber);

      const rejected = requests.filter(
        (request) => request.path === "/" && request.accept === "*/*"
      ).length;

      expect(rejected).toBeGreaterThan(0);
      expect(verdict.outcome).toBe("failed");
      expect(verdict.reason).toBe("WatchFailed:non-200-or-incomplete-watch");
      expect(verdict.provenance).toHaveLength(rejected);
      expect(verdict.counts.nonOk).toBe(rejected);
      expect(verdict.counts.observed).toBeGreaterThan(rejected);
      expect(verdict.counts.routes).toBe(1);

      for (const row of verdict.provenance ?? []) {
        expect(row.source).toBe("https://example.test/");
        expect(row.status).toContain('"status":404');
        expect(row.status).toContain('"cfRay":"ray-first"');
      }
    })
);
