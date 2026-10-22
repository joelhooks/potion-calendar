import { expect, it } from "@effect/vitest";
import {
  Effect,
  Fiber,
  Layer,
  Option,
  Predicate,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import type { Fiber as FiberType } from "effect";
import { TestClock } from "effect/testing";

import { Message, update } from "../src/client/app.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import {
  SearchNotice,
  SearchProblem,
  SearchTask,
} from "../src/client/search/model.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { searchTask } from "../src/client/search/source.js";
import { searchResponse, unexpectedSearchClient } from "./search-fixture.js";
import { loadedSearch } from "./search-more-fixture.js";

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

it.effect.prop(
  "repeated page triggers start one actor read immediately and settlement keeps the subscription task stable",
  { repeats: Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 1 })) },
  ({ repeats }) =>
    Effect.gen(function* pageActor() {
      const initial = loadedSearch();
      let model = initial;

      for (let index = 0; index < repeats; index += 1) {
        ({ model } = update(model, Message.SearchMore()));
      }

      const input = Option.getOrThrow(searchTask(model));
      const calls = yield* Ref.make<readonly (typeof input.request)[]>([]);

      const response = {
        ...searchResponse([]),
        pageInfo: [
          { accountId: "work", calendarId: "primary", forwardHasMore: false },
        ],
        window: Option.getOrThrow(initial.search.response).window,
      };

      const client = CalendarSearchClient.of({
        prefetch: unexpectedSearchClient.prefetch,
        search: (request) =>
          Ref.update(calls, (values) => [...values, request]).pipe(
            Effect.as(response)
          ),
      });

      const notices = yield* observe(input).pipe(
        Stream.runCollect,
        Effect.provide(runtimeLayer(client))
      );

      expect(yield* Ref.get(calls)).toEqual([input.request]);
      expect(
        notices.some((notice) => SearchNotice.guards.LoadingMore(notice))
      ).toBe(true);
      expect(
        notices.some((notice) => SearchNotice.guards.Debouncing(notice))
      ).toBe(false);
      expect(notices.at(-1)).toEqual(
        SearchNotice.cases.Ready.make({ response, task: input })
      );

      for (const notice of notices) {
        const next = update(model, Message.ReceivedSearch({ notice }));
        expect(
          next.commands?.some(
            (command) => command.name === "RestoreSearchScroll"
          ) ?? false
        ).toBe(false);
        ({ model } = next);
      }

      expect(searchTask(model)).toEqual(Option.some(input));
      expect(Option.getOrThrow(model.search.response).results).toEqual(
        Option.getOrThrow(initial.search.response).results
      );
      yield* TestClock.adjust(10_000);
      expect(yield* Ref.get(calls)).toHaveLength(1);
    })
);

it.effect(
  "interrupting a continuation actor cancels its pending provider effect without emitting a ready page",
  () =>
    Effect.gen(function* cancelledPage() {
      const { model } = update(loadedSearch(), Message.SearchMore());
      const input = Option.getOrThrow(searchTask(model));
      const called = yield* Queue.unbounded<typeof input.request>();
      const interruptions = yield* Ref.make(0);

      const notices = yield* Ref.make<readonly (typeof SearchNotice.Type)[]>(
        []
      );

      const client = CalendarSearchClient.of({
        prefetch: unexpectedSearchClient.prefetch,
        search: (request) =>
          Queue.offer(called, request).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Ref.update(interruptions, (count) => count + 1)
            )
          ),
      });

      yield* Effect.gen(function* pendingPage() {
        const fiber = yield* observe(input).pipe(
          Stream.runForEach((notice) =>
            Ref.update(notices, (values) => [...values, notice])
          ),
          Effect.forkChild
        );

        expect(yield* Queue.take(called)).toEqual(input.request);
        yield* Fiber.interrupt(fiber);
        expect(yield* Ref.get(interruptions)).toBe(1);
        expect(
          (yield* Ref.get(notices)).some((notice) =>
            SearchNotice.guards.Ready(notice)
          )
        ).toBe(false);
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
