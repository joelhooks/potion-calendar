import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Ref, Stream } from "effect";

import { OccurrenceClient } from "../src/client/selection-commands/client.js";
import type { OccurrenceProblem } from "../src/client/selection-commands/model.js";
import { OccurrenceRuntime } from "../src/client/selection-commands/runtime.js";
import {
  beginCommandOccurrence,
  commandNeighbor,
  selectionCommandFixture,
} from "./selection-command-fixture.js";

it.effect(
  "the actual occurrence actor waits for the client and emits one immutable terminal result",
  () =>
    Effect.gen(function* occurrenceActorRead() {
      const { model, event } = selectionCommandFixture();
      const { task } = beginCommandOccurrence(model, "next");

      const reply = yield* Deferred.make<
        CalendarEventValue | null,
        typeof OccurrenceProblem.Type
      >();

      const started = yield* Deferred.make<boolean>();
      const requests = yield* Ref.make<readonly (typeof task.request)[]>([]);

      const client = OccurrenceClient.of({
        read: (request) =>
          Effect.gen(function* read() {
            yield* Ref.update(requests, (before) => [...before, request]);
            yield* Deferred.succeed(started, true);

            return yield* Deferred.await(reply);
          }),
      });

      const runtime = yield* OccurrenceRuntime.pipe(
        Effect.provide(OccurrenceRuntime.layer),
        Effect.provideService(OccurrenceClient, client)
      );

      const observed = yield* Effect.forkChild(
        Stream.runCollect(runtime.observe(task).pipe(Stream.take(2)))
      );

      yield* Deferred.await(started);
      expect(yield* Ref.get(requests)).toEqual([task.request]);
      const neighbor = commandNeighbor(event);
      yield* Deferred.succeed(reply, neighbor);
      const notices = yield* Fiber.join(observed);
      expect(notices.map((notice) => notice._tag)).toEqual([
        "Loading",
        "Ready",
      ]);
      expect(notices[1]).toHaveProperty("event.eventId", neighbor.eventId);
      expect(yield* Ref.get(requests)).toHaveLength(1);
    })
);

it.effect(
  "ending the occurrence subscription scope interrupts the outstanding client read without replay",
  () =>
    Effect.gen(function* cancelOccurrenceActor() {
      const { model, event } = selectionCommandFixture();
      const { task } = beginCommandOccurrence(model, "previous");

      const reply = yield* Deferred.make<
        CalendarEventValue | null,
        typeof OccurrenceProblem.Type
      >();

      const started = yield* Deferred.make<boolean>();
      const cancelled = yield* Deferred.make<boolean>();
      const calls = yield* Ref.make(0);

      const client = OccurrenceClient.of({
        read: () =>
          Effect.gen(function* waitForRead() {
            yield* Ref.update(calls, (count) => count + 1);
            yield* Deferred.succeed(started, true);

            return yield* Deferred.await(reply);
          }).pipe(
            Effect.onInterrupt(() =>
              Deferred.succeed(cancelled, true).pipe(Effect.asVoid)
            )
          ),
      });

      const runtime = yield* OccurrenceRuntime.pipe(
        Effect.provide(OccurrenceRuntime.layer),
        Effect.provideService(OccurrenceClient, client)
      );

      const observed = yield* Effect.forkChild(
        Stream.runDrain(runtime.observe(task))
      );

      yield* Deferred.await(started);
      yield* Fiber.interrupt(observed);
      yield* Deferred.await(cancelled);
      yield* Deferred.succeed(reply, commandNeighbor(event, -1));
      expect(yield* Ref.get(calls)).toBe(1);
    })
);
