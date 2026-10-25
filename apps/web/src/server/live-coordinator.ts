import { Provider } from "@calendar/calendar";
import type { CalendarFailureValue } from "@calendar/calendar";
import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Layer,
  Predicate,
  Result,
  Schema,
} from "effect";
import { types } from "xstate";

import { liveAdmission } from "./live-admission.js";
import type { LiveAdmission } from "./live-admission.js";
import { DrainService, Step } from "./live-drain-service.js";
import type { DrainStep, FailedStep } from "./live-drain-service.js";
import type { LiveJobs } from "./live-jobs.js";
import type { LiveOutputValue, LiveWorkValue } from "./live-work.js";
import { LiveWork } from "./live-work.js";

export const LiveSyncPolicy = Context.Reference<{
  readonly debounceMs: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
}>("@calendar/web/LiveSyncPolicy", {
  defaultValue: () => ({
    debounceMs: 250,
    retryBaseMs: 1000,
    retryMaxMs: 60_000,
  }),
});

const processWork = createEffectLogic({
  effect: ({ input }) =>
    DrainService.use((service) => service.process(input.key)),
  schemas: { input: Schema.Struct({ key: Schema.String }) },
});

const recoverWork = createEffectLogic({
  effect: ({ input }) => DrainService.use((service) => service.recover(input)),
  schemas: { input: types<FailedStep>() },
});

interface DrainContext {
  readonly key: string;
  readonly passes: number;
  readonly step: DrainStep | undefined;
}

export const liveDrainMachine = setupEffect({
  actors: { processWork, recoverWork },
  schemas: {
    context: types<DrainContext>(),
    input: Schema.Struct({ key: Schema.String }),
  },
}).createMachine({
  context: ({ input }) => ({ key: input.key, passes: 0, step: undefined }),
  initial: "processing",
  output: ({
    context,
  }): Result.Result<LiveOutputValue | undefined, CalendarFailureValue> =>
    context.step?._tag === "Failed"
      ? Result.fail(context.step.error)
      : Result.succeed(context.step?.output),
  states: {
    processing: {
      invoke: {
        input: ({ context }) => ({ key: context.key }),
        onDone: ({ context, event }) => {
          if (Predicate.isTagged(event.output, "Failed")) {
            return { context: { step: event.output }, target: "recovering" };
          }

          if (
            Predicate.isTagged(event.output, "Completed") &&
            event.output.followup &&
            context.passes === 0
          ) {
            return {
              context: { passes: context.passes + 1, step: event.output },
              reenter: true,
              target: "processing",
            };
          }

          return { context: { step: event.output }, target: "settled" };
        },
        src: "processWork",
      },
    },
    recovering: {
      invoke: {
        input: ({ context }) => {
          if (!Predicate.isTagged(context.step, "Failed")) {
            throw new Error("Missing failed live job");
          }

          return context.step;
        },
        onDone: { target: "settled" },
        src: "recoverWork",
      },
    },
    settled: { type: "final" },
  },
});

export const makeLiveCoordinator = Effect.fn("makeLiveCoordinator")(
  function* makeLiveCoordinator(
    jobs: Pick<LiveJobs, "get" | "last" | "complete" | "retry" | "discard">,
    execute: (
      work: LiveWorkValue
    ) => Effect.Effect<LiveOutputValue, CalendarFailureValue>,
    admission: LiveAdmission = liveAdmission()
  ) {
    const policy = yield* LiveSyncPolicy;

    const running = new Map<
      string,
      Deferred.Deferred<LiveOutputValue | undefined, CalendarFailureValue>
    >();

    const process = Effect.fn("liveCoordinator.process")(function* process(
      key: string
    ): Effect.fn.Return<DrainStep> {
      const loaded = yield* jobs.get(key).pipe(Effect.result);

      if (Result.isFailure(loaded)) {
        return Step.Failed({ error: loaded.failure, job: undefined });
      }

      const job = loaded.success;

      if (job === undefined) {
        const previous = yield* jobs.last(key).pipe(Effect.result);

        return Result.isFailure(previous)
          ? Step.Failed({ error: previous.failure, job: undefined })
          : Step.Empty({ output: previous.success });
      }

      if (
        LiveWork.guards.Inventory(job.work) &&
        job.attempts > 0 &&
        job.dueAt > (yield* Clock.currentTimeMillis)
      ) {
        const previous = yield* jobs.last(key).pipe(Effect.result);

        return Result.isFailure(previous)
          ? Step.Failed({ error: previous.failure, job })
          : Step.Empty({ output: previous.success });
      }

      const outcome = yield* execute(job.work).pipe(Effect.result);

      if (Result.isFailure(outcome)) {
        return Step.Failed({ error: outcome.failure, job });
      }

      const completed = yield* jobs
        .complete(job, outcome.success)
        .pipe(Effect.result);

      return Result.isFailure(completed)
        ? Step.Failed({ error: completed.failure, job })
        : Step.Completed({
            followup: !completed.success,
            output: outcome.success,
          });
    });

    const recover = Effect.fn("liveCoordinator.recover")(function* recover(
      step: FailedStep
    ) {
      if (step.job === undefined) {
        return;
      }

      if (
        ["NotConnected", "Revoked"].includes(step.error._tag) ||
        (LiveWork.guards.Calendar(step.job.work) &&
          ["NotFound", "Gone", "UnsupportedRecurrenceSplit"].includes(
            step.error._tag
          ))
      ) {
        yield* jobs.discard(step.job.key);

        return;
      }

      const inventoryDelays = [60_000, 300_000, 900_000, 3_600_000];

      const backoff = LiveWork.guards.Inventory(step.job.work)
        ? (inventoryDelays[
            Math.min(Math.max(step.job.attempts, 0), inventoryDelays.length - 1)
          ] ?? 3_600_000)
        : Math.min(
            policy.retryMaxMs,
            policy.retryBaseMs * 2 ** Math.min(step.job.attempts, 20)
          );

      const delay = Predicate.isTagged(step.error, "RateLimited")
        ? Math.max(backoff, step.error.retryAfterMs)
        : backoff;

      yield* jobs.retry(step.job, yield* Clock.currentTimeMillis, delay);
    });

    const run = Effect.fn("liveCoordinator.run")(function* run(key: string) {
      const slot = yield* Effect.sync(() => {
        if (!admission.accepts()) {
          return { role: "paused" as const };
        }

        const existing = running.get(key);

        if (existing !== undefined) {
          return { completion: existing, role: "joined" as const };
        }

        const completion = Deferred.makeUnsafe<
          LiveOutputValue | undefined,
          CalendarFailureValue
        >();

        running.set(key, completion);

        return { completion, role: "owner" as const };
      });

      if (slot.role === "paused") {
        return yield* new Provider({
          message: "Account deletion has paused live work",
          operation: "live",
          status: 409,
        });
      }

      if (slot.role === "joined") {
        return yield* Deferred.await(slot.completion);
      }

      return yield* Effect.gen(function* runDrain() {
        const actor = yield* createEffectActor(liveDrainMachine, {
          input: { key },
        });

        yield* watchActor("calendarLiveDrain", actor);
        // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected actor crashes propagate as defects and leave durable work pending.
        const outcome = yield* join(actor).pipe(Effect.orDie);

        if (Result.isFailure(outcome)) {
          return yield* outcome.failure;
        }

        return outcome.success;
      }).pipe(
        Effect.provideService(DrainService, { process, recover }),
        Effect.scoped,
        Effect.onExit((exit) =>
          Effect.gen(function* releaseFlight() {
            yield* Effect.sync(() => {
              running.delete(key);
            });
            yield* Deferred.done(slot.completion, exit);
          })
        )
      );
    });

    const awaitExisting = Effect.fn("liveCoordinator.awaitExisting")(
      function* awaitExisting(key: string) {
        const completion = yield* Effect.sync(() => running.get(key));

        if (completion !== undefined) {
          yield* Deferred.await(completion);
        }
      }
    );

    const awaitAll = Effect.fn("liveCoordinator.awaitAll")(
      function* awaitAll() {
        const completions = yield* Effect.sync(() => [...running.values()]);
        yield* Effect.forEach((completion: (typeof completions)[number]) =>
          Deferred.await(completion).pipe(Effect.ignore)
        )(completions);
      }
    );

    const pause = Effect.fn("liveCoordinator.pause")(function* pause() {
      const admitted = yield* Effect.sync(admission.pause);

      if (!admitted) {
        return yield* new Provider({
          message: "Account deletion is already in progress",
          operation: "live",
          status: 409,
        });
      }

      return yield* awaitAll();
    });

    return {
      awaitAll,
      awaitExisting,
      pause,
      resume: Effect.sync(admission.resume),
      run,
    };
  }
);

export type LiveCoordinatorValue = Effect.Success<
  ReturnType<typeof makeLiveCoordinator>
>;

export class LiveCoordinator extends Context.Service<
  LiveCoordinator,
  LiveCoordinatorValue
>()("@calendar/web/LiveCoordinator") {
  static layer(
    jobs: Pick<LiveJobs, "get" | "last" | "complete" | "retry" | "discard">,
    execute: (
      work: LiveWorkValue
    ) => Effect.Effect<LiveOutputValue, CalendarFailureValue>,
    admission: LiveAdmission = liveAdmission()
  ) {
    return Layer.effect(this, makeLiveCoordinator(jobs, execute, admission));
  }
}
