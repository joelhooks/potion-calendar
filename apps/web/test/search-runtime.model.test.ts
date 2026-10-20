import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Predicate, Ref, Schema, Stream } from "effect";
import type { Fiber as FiberType } from "effect";
import { TestClock } from "effect/testing";

import { CalendarSearchClient } from "../src/client/search/client.js";
import {
  SearchNotice,
  SearchProblem,
  SearchTask,
} from "../src/client/search/model.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { searchResponse, unexpectedSearchClient } from "./search-fixture.js";

const task = (query: string, revision = 1) =>
  SearchTask.make({
    personId: "fixture-person",
    request: { query, timeZone: "America/Los_Angeles", weekStartsOn: 0 },
    revision,
  });

const runtimeLayer = (client: typeof unexpectedSearchClient) =>
  SearchRuntime.layer.pipe(
    Layer.provide(Layer.succeed(CalendarSearchClient, client))
  );

const observe = (input: typeof SearchTask.Type) =>
  Stream.unwrap(
    SearchRuntime.use((runtime) => Effect.succeed(runtime.observe(input)))
  );

it.effect.prop(
  "generated edit sequences start only settled nonblank requests and interrupt superseded reads",
  {
    edits: Schema.Array(
      Schema.Struct({
        elapsed: Schema.Int.check(
          Schema.isBetween({ maximum: 400, minimum: 0 })
        ),
        query: Schema.Literals([
          "a",
          "team",
          " owner@example.test ",
          "",
          "   ",
        ]),
      })
    ).check(Schema.isMinLength(1), Schema.isMaxLength(10)),
  },
  ({ edits }) =>
    Effect.gen(function* querySequence() {
      const calls = yield* Ref.make<readonly string[]>([]);
      const interrupted = yield* Ref.make(0);

      const client = CalendarSearchClient.of({
        prefetch: unexpectedSearchClient.prefetch,
        search: (input) =>
          Ref.update(calls, (values) => [...values, input.query]).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Ref.update(interrupted, (count) => count + 1)
            )
          ),
      });

      const run = Effect.gen(function* editModel() {
        let current: FiberType.Fiber<void> | undefined;
        let pending = false;
        let cancellations = 0;
        let expected: readonly string[] = [];

        for (const [revision, edit] of edits.entries()) {
          if (current !== undefined) {
            yield* Fiber.interrupt(current);
            cancellations += Number(pending);
          }

          current = yield* observe(task(edit.query, revision)).pipe(
            Stream.runDrain,
            Effect.forkChild
          );
          yield* TestClock.adjust(edit.elapsed);
          pending = edit.query.trim() !== "" && edit.elapsed >= 250;
          expected = pending ? [...expected, edit.query] : expected;
          expect(yield* Ref.get(calls)).toEqual(expected);
          expect(yield* Ref.get(interrupted)).toBe(cancellations);
        }
      });

      yield* run.pipe(Effect.provide(runtimeLayer(client)));
    })
);

it.effect(
  "the actor emits the searching boundary at250ms and preserves the complete RPC response",
  () =>
    Effect.gen(function* boundary() {
      const calls = yield* Ref.make(0);
      const response = searchResponse();

      const client = CalendarSearchClient.of({
        prefetch: unexpectedSearchClient.prefetch,
        search: () =>
          Ref.update(calls, (count) => count + 1).pipe(Effect.as(response)),
      });

      yield* Effect.gen(function* observeBoundary() {
        const fiber = yield* observe(task("planning")).pipe(
          Stream.runCollect,
          Effect.forkChild
        );

        yield* TestClock.adjust(249);
        expect(yield* Ref.get(calls)).toBe(0);
        yield* TestClock.adjust(1);
        const notices = yield* Fiber.join(fiber);
        expect(yield* Ref.get(calls)).toBe(1);
        expect(
          notices.some((notice) => Predicate.isTagged(notice, "Searching"))
        ).toBe(true);
        expect(notices.at(-1)).toEqual(
          SearchNotice.cases.Ready.make({ response, task: task("planning") })
        );
      }).pipe(Effect.provide(runtimeLayer(client)));
    })
);

it.effect("a typed search failure settles without retries", () =>
  Effect.gen(function* failedSearch() {
    const calls = yield* Ref.make(0);

    const problem = SearchProblem.cases.Transport.make({
      message: "Connection lost",
    });

    const client = CalendarSearchClient.of({
      prefetch: unexpectedSearchClient.prefetch,
      search: () =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.andThen(Effect.fail(problem))
        ),
    });

    yield* Effect.gen(function* failureNotice() {
      const fiber = yield* observe(task("planning")).pipe(
        Stream.runCollect,
        Effect.forkChild
      );

      yield* TestClock.adjust(250);
      const notices = yield* Fiber.join(fiber);
      expect(notices.at(-1)).toEqual(
        SearchNotice.cases.Failed.make({ problem, task: task("planning") })
      );
      yield* TestClock.adjust(10_000);
      expect(yield* Ref.get(calls)).toBe(1);
    }).pipe(Effect.provide(runtimeLayer(client)));
  })
);
