import { watchActor } from "@calendar/capability/actor-watch";
import type { Verdict } from "@calendar/check-harness";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import {
  Clock,
  Effect,
  Option,
  Result,
  Schedule,
  Schema,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { types } from "xstate";

export const WatchObservationSchema = Schema.Struct({
  accept: Schema.String,
  body: Schema.String,
  cfRay: Schema.optional(Schema.String),
  content: Schema.Boolean,
  incidentId: Schema.optional(Schema.String),
  observedAt: Schema.Natural,
  route: Schema.String,
  status: Schema.Natural,
});

export type WatchObservation = typeof WatchObservationSchema.Type;

export const WatchEvidenceSchema = Schema.Struct({
  cycles: Schema.Natural,
  observations: Schema.Array(WatchObservationSchema),
  routes: Schema.Array(Schema.String),
  streak: Schema.Natural,
});

export type WatchEvidence = typeof WatchEvidenceSchema.Type;

export class WatchFailed extends Schema.TaggedError<WatchFailed>()(
  "WatchFailed",
  {
    evidence: WatchEvidenceSchema,
    reason: Schema.String,
  }
) {}

export const failureBodyBytes = 4096;

const isUnprintable = (codePoint: number) =>
  (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a) ||
  (codePoint >= 0x7f && codePoint <= 0x9f);

export const printableBody = (bytes: Uint8Array) =>
  Array.from(new TextDecoder().decode(bytes), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return isUnprintable(codePoint)
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");

export const nextWatchEvidence = (
  previous: WatchEvidence,
  observations: readonly WatchObservation[]
): WatchEvidence => ({
  ...previous,
  cycles: previous.cycles + 1,
  observations: [...previous.observations, ...observations],
  streak: observations.some((row) => row.content && row.status === 500)
    ? previous.streak + 1
    : 0,
});

export const fixedWatchRoutes = [{ content: true, route: "/" }] as const;

const WatchInputSchema = Schema.Struct({
  baseUrl: Schema.String,
  deadline: Schema.Natural,
  intervalMs: Schema.Natural,
  threshold: Schema.Int.check(Schema.isGreaterThan(0)),
});

type WatchInput = typeof WatchInputSchema.Type;

interface WatchContext {
  readonly evidence: WatchEvidence;
  readonly input: WatchInput;
}

interface WatchRequest {
  readonly accept: string;
  readonly content: boolean;
  readonly route: string;
}

export const probeTimeoutMs = 15_000;

const probeRoute = Effect.fn("probeRoute")(function* probeRoute(
  baseUrl: string,
  request: WatchRequest
) {
  const client = yield* HttpClient.HttpClient;
  const observedAt = yield* Clock.currentTimeMillis;
  const separator = request.route.includes("?") ? "&" : "?";

  return yield* Effect.gen(function* readResponse() {
    const response = yield* client.execute(
      HttpClientRequest.get(
        `${baseUrl.replace(/\/$/u, "")}${request.route}${separator}__rat_watch=${observedAt}`
      ).pipe(HttpClientRequest.setHeader("accept", request.accept))
    );

    const bytes =
      response.status === 200
        ? []
        : yield* response.stream.pipe(
            Stream.flatMap((chunk) => Stream.fromIterable(chunk)),
            Stream.take(failureBodyBytes),
            Stream.runCollect
          );

    const observation = {
      ...request,
      body: printableBody(new Uint8Array(bytes)),
      cfRay: response.headers["cf-ray"],
      incidentId: response.headers["x-incident-id"],
      observedAt,
      status: response.status,
    } satisfies WatchObservation;

    return { observation, response };
  }).pipe(
    Effect.timeout(probeTimeoutMs),
    Effect.map(({ observation, response }) => ({
      observation,
      response: Option.some(response),
    })),
    Effect.orElseSucceed(() => ({
      observation: {
        ...request,
        body: "transport-or-body-read-unavailable",
        observedAt,
        status: 0,
      } satisfies WatchObservation,
      response: Option.none(),
    }))
  );
});

const logFailures = (observations: readonly WatchObservation[]) =>
  Effect.forEach(
    observations.filter((row) => row.status !== 200),
    (observation) =>
      Effect.logWarning("deploy-watch-first-class-evidence", observation),
    { discard: true }
  );

export const observeWatchCycle = Effect.fn("observeWatchCycle")(
  function* observeWatchCycle(input: WatchInput) {
    const now = yield* Clock.currentTimeMillis;

    if (now >= input.deadline) {
      return { finished: true, observations: [] };
    }

    const requests = fixedWatchRoutes.flatMap((route) =>
      ["*/*", "text/html"].map((accept) => ({ ...route, accept }))
    );

    const observations = yield* Effect.forEach(
      requests,
      (request) =>
        probeRoute(input.baseUrl, request).pipe(
          Effect.map((probe) => probe.observation)
        ),
      { concurrency: 12 }
    );

    yield* logFailures(observations);

    return { finished: false, observations };
  },
  Effect.scoped
);

const observe = createEffectLogic({
  effect: ({ input }) => observeWatchCycle(input),
  schemas: { input: WatchInputSchema },
});

const wait = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* waitForCycle() {
      const remaining = Math.max(
        0,
        input.deadline - (yield* Clock.currentTimeMillis)
      );

      yield* Effect.void.pipe(
        Effect.repeat({
          schedule: Schedule.spaced(Math.min(input.intervalMs, remaining)),
          times: 1,
        })
      );
    }),
  schemas: { input: WatchInputSchema },
});

export const watchMachine = setupEffect({
  actors: { observe, wait },
  schemas: { context: types<WatchContext>(), input: WatchInputSchema },
}).createMachine({
  context: ({ input }) => ({
    evidence: {
      cycles: 0,
      observations: [],
      routes: fixedWatchRoutes.map(({ route }) => route),
      streak: 0,
    },
    input,
  }),
  initial: "observing",
  output: ({ context }) => context.evidence,
  states: {
    completed: { type: "final" },
    failed: { type: "final" },
    observing: {
      invoke: {
        input: ({ context }) => context.input,
        onDone: ({ context, event }) => {
          const evidence = event.output.finished
            ? context.evidence
            : nextWatchEvidence(context.evidence, event.output.observations);

          let target = event.output.finished ? "completed" : "waiting";

          if (evidence.streak >= context.input.threshold) {
            target = "failed";
          }

          return { context: { evidence }, target };
        },
        src: "observe",
      },
    },
    waiting: {
      invoke: {
        input: ({ context }) => context.input,
        onDone: { target: "observing" },
        src: "wait",
      },
    },
  },
});

export const watchDefaults = { durationMs: 600_000, intervalMs: 10_000 };

export const watchDeployment = Effect.fn("watchDeployment")(
  function* watchDeployment(
    baseUrl: string,
    durationMs?: number,
    intervalMs?: number
  ) {
    const now = yield* Clock.currentTimeMillis;
    const duration = durationMs ?? watchDefaults.durationMs;
    const interval = intervalMs ?? watchDefaults.intervalMs;

    const actor = yield* createEffectActor(watchMachine, {
      input: {
        baseUrl,
        deadline: now + duration,
        intervalMs: interval,
        threshold: 2,
      },
    });

    yield* watchActor("watchMachine", actor);

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected watch actor failures remain defects rather than a passing observation.
    const evidence = yield* join(actor).pipe(
      Effect.orDie,
      Effect.flatMap(Schema.decodeUnknownEffect(WatchEvidenceSchema)),
      Effect.orDie
    );

    if (
      evidence.cycles === 0 ||
      evidence.observations.some((row) => row.status !== 200)
    ) {
      return yield* new WatchFailed({
        evidence,
        reason:
          evidence.streak >= 2
            ? "consecutive-content-500-cycles"
            : "non-200-or-incomplete-watch",
      });
    }

    return evidence;
  },
  Effect.scoped
);

export const watchVerdict = Effect.fn("watchVerdict")(function* watchVerdict(
  baseUrl: string
) {
  const result = yield* watchDeployment(baseUrl).pipe(Effect.result);

  const evidence = Result.isSuccess(result)
    ? result.success
    : result.failure.evidence;

  const failed = Result.isFailure(result);

  const rejected = evidence.observations.flatMap((row, index) =>
    row.status === 200 ? [] : [{ index, row }]
  );

  return {
    check: "post-deploy-watch",
    control: 1,
    counts: {
      cycles: evidence.cycles,
      nonOk: rejected.length,
      observed: evidence.observations.length,
      routes: evidence.routes.length,
    },
    observedAt: yield* Clock.currentTimeMillis,
    provenance: rejected.map(({ index, row }) => ({
      fetchedAt: row.observedAt,
      id: `watch:${index}`,
      source: `${baseUrl}${row.route}`,
      status: JSON.stringify(row),
    })),
    reason: failed
      ? `WatchFailed:${result.failure.reason}`
      : "bounded-watch-confirmed",
    ...(failed
      ? { exitCode: 2, outcome: "failed", status: "red" }
      : { exitCode: 0, outcome: "passed", status: "green" }),
  } satisfies Verdict;
});
