import type {
  ActorWatchService,
  WatchableActor,
} from "@calendar/capability/actor-watch";
import { Effect, Option, Queue, Schema, Stream } from "effect";

import { GestureResult } from "../src/client/editing/gesture-model.js";

const Observation = Schema.Struct({
  context: Schema.Struct({
    blockClick: Schema.Boolean,
    completed: Schema.optional(GestureResult),
    preview: Schema.optional(GestureResult),
    sequence: Schema.Int,
  }),
  status: Schema.String,
  value: Schema.String,
});

const Inspection = Schema.Struct({
  actorRef: Schema.Struct({ sessionId: Schema.String }),
  rootId: Schema.String,
  snapshot: Observation,
  type: Schema.Literals(["@xstate.transition"]),
});

const decodeInspection = Schema.decodeUnknownOption(Inspection);

type Snapshot = typeof Observation.Type;

interface Receipt {
  readonly id: number;
  readonly machine: string;
  readonly snapshot: Snapshot;
}

export const observePhoneActors = Effect.fn("phoneTouch.observeActors")(
  function* observePhoneActors() {
    const events = yield* Queue.unbounded<Receipt>();
    const actors = new Map<string, WatchableActor>();
    const latest = new Map<string, Receipt>();
    let cursor = 0;

    const watcher: ActorWatchService = {
      watch: Effect.fn("phoneTouch.watch")(function* watch(
        machine: string,
        actor: WatchableActor
      ) {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            actors.set(machine, actor);

            return actor.inspect((raw) => {
              const decoded = decodeInspection(raw);

              if (
                Option.isNone(decoded) ||
                decoded.value.actorRef.sessionId !== decoded.value.rootId
              ) {
                return;
              }

              cursor += 1;

              const receipt = {
                id: cursor,
                machine,
                snapshot: decoded.value.snapshot,
              };

              latest.set(machine, receipt);
              Queue.offerUnsafe(events, receipt);
            });
          }),
          (subscription) =>
            Effect.sync(() => {
              subscription.unsubscribe();
              actors.delete(machine);
            })
        );
      }),
    };

    const read = Effect.fn("phoneTouch.readActor")(function* read(
      machine: string
    ) {
      const actor = yield* Effect.fromNullishOr(actors.get(machine));

      return yield* Schema.decodeUnknownEffect(Observation)(
        actor.getSnapshot()
      );
    });

    const next = Effect.fn("phoneTouch.nextActor")(function* next(
      machine: string,
      after: number,
      accepts: (snapshot: Snapshot) => boolean
    ) {
      const receipt = latest.get(machine);

      if (
        receipt !== undefined &&
        receipt.id > after &&
        accepts(receipt.snapshot)
      ) {
        return receipt.snapshot;
      }

      const received = yield* Stream.fromQueue(events).pipe(
        Stream.filter(
          (row) =>
            row.machine === machine && row.id > after && accepts(row.snapshot)
        ),
        Stream.runHead
      );

      return Option.getOrThrow(received).snapshot;
    });

    return { cursor: () => cursor, next, read, watcher };
  }
);
