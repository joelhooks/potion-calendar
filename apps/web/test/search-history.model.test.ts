import { SearchPageTarget } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Deferred, Effect, Option, Queue, Ref, Schema, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { SearchProblem } from "../src/client/search/model.js";
import { searchPageMachine } from "../src/client/search/page-machine.js";
import { SearchPageNotice } from "../src/client/search/page-model.js";
import { searchQueryTask } from "../src/client/search/source.js";
import type { SearchResponse } from "../src/search-contract.js";
import { searchResponse, unexpectedSearchClient } from "./search-fixture.js";
import { loadedSearch } from "./search-more-fixture.js";

const pageRequests = () => {
  const model = loadedSearch();
  const task = Option.getOrThrow(searchQueryTask(model));
  const { window } = Option.getOrThrow(model.search.response);

  return {
    forward: {
      continuation: {
        pages: [
          SearchPageTarget.cases.Forward.make({
            accountId: "work",
            calendarId: "primary",
            pageToken: "forward-2",
          }),
        ],
        window,
      },
      task,
    },
    reverse: {
      continuation: {
        pages: [
          SearchPageTarget.cases.Reverse.make({
            accountId: "work",
            calendarId: "primary",
            windowEnd: "2025-09-20T07:00:00Z",
          }),
        ],
        window,
      },
      task,
    },
    task,
  };
};

const settledRegion = (
  actor: EffectActor<typeof searchPageMachine>,
  direction: "forward" | "reverse"
) =>
  snapshots(actor).pipe(
    Stream.filter((snapshot) =>
      direction === "forward"
        ? !snapshot.matches({ forward: "loading" })
        : !snapshot.matches({ reverse: "loading" })
    ),
    Stream.runHead,
    Effect.map(Option.getOrThrow)
  );

it.effect.prop(
  "parallel regions keep independent reads, failures and exhaustion when reverse settles after forward or before it",
  {
    forwardFails: Schema.Boolean,
    repeats: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 1 })),
    reverseFirst: Schema.Boolean,
  },
  ({ forwardFails, reverseFirst, repeats }) =>
    Effect.gen(function* parallelPageHistory() {
      const requests = pageRequests();

      const forward = yield* Deferred.make<
        typeof SearchResponse.Type,
        typeof SearchProblem.Type
      >();

      const reverse = yield* Deferred.make<
        typeof SearchResponse.Type,
        typeof SearchProblem.Type
      >();

      const called = yield* Queue.unbounded<string>();
      const calls = yield* Ref.make<readonly string[]>([]);

      const client = CalendarSearchClient.of({
        prefetch: unexpectedSearchClient.prefetch,
        search: (input) => {
          const direction =
            input.continuation?.pages[0]?._tag === "Reverse"
              ? "reverse"
              : "forward";

          return Ref.update(calls, (values) => [...values, direction]).pipe(
            Effect.andThen(Queue.offer(called, direction)),
            Effect.andThen(
              Deferred.await(direction === "forward" ? forward : reverse)
            )
          );
        },
      });

      yield* Effect.gen(function* actorHistory() {
        const actor = yield* createEffectActor(searchPageMachine, {
          input: requests.task,
        });

        yield* watchActor("test.search.parallel", actor);
        yield* send(actor, { page: requests.forward, type: "FORWARD" });
        expect(yield* Queue.take(called)).toBe("forward");
        yield* send(actor, { page: requests.reverse, type: "REVERSE" });
        expect(yield* Queue.take(called)).toBe("reverse");

        for (let index = 0; index < repeats; index += 1) {
          yield* send(actor, { page: requests.forward, type: "FORWARD" });
          yield* send(actor, { page: requests.reverse, type: "REVERSE" });
        }

        const response = {
          ...searchResponse([]),
          pageInfo: [
            {
              accountId: "work",
              calendarId: "primary",
              forwardHasMore: false,
              olderHasMore: false,
            },
          ],
          window: requests.forward.continuation.window,
        };

        if (reverseFirst) {
          yield* Deferred.succeed(reverse, response);
          const snapshot = yield* settledRegion(actor, "reverse");
          expect(snapshot.matches({ reverse: "exhausted" })).toBe(true);
          expect(snapshot.matches({ forward: "loading" })).toBe(true);
        }

        yield* forwardFails
          ? Deferred.fail(
              forward,
              SearchProblem.cases.Transport.make({
                message: "Retry this forward page",
              })
            )
          : Deferred.succeed(forward, response);

        const afterForward = yield* settledRegion(actor, "forward");
        expect(
          afterForward.matches({
            forward: forwardFails ? "failed" : "exhausted",
          })
        ).toBe(true);
        expect(
          afterForward.matches({
            reverse: reverseFirst ? "exhausted" : "loading",
          })
        ).toBe(true);

        if (!reverseFirst) {
          yield* Deferred.succeed(reverse, response);
          const snapshot = yield* settledRegion(actor, "reverse");
          expect(snapshot.matches({ reverse: "exhausted" })).toBe(true);
          expect(
            snapshot.matches({ forward: forwardFails ? "failed" : "exhausted" })
          ).toBe(true);
        }

        expect(yield* Ref.get(calls)).toEqual(["forward", "reverse"]);
      }).pipe(
        Effect.provideService(CalendarSearchClient, client),
        Effect.scoped
      );
    })
);

it("a new query mid-flight drops both old page results and their queued anchor-merge messages", () => {
  const base = loadedSearch();
  const response = Option.getOrThrow(base.search.response);

  const initial = {
    ...base,
    search: {
      ...base.search,
      response: Option.some({
        ...response,
        pageInfo: response.pageInfo.map((page) => ({
          ...page,
          olderCursor: { windowEnd: "2025-09-20T07:00:00Z" },
        })),
      }),
    },
  };

  const forward = update(initial, Message.SearchMore()).model;
  const both = update(forward, Message.SearchOlder()).model;
  expect(both.search.phase).toBe("LoadingMore");
  expect(both.search.reversePhase).toBe("LoadingMore");
  const task = Option.getOrThrow(searchQueryTask(both));

  const requests = {
    forward: {
      continuation: Option.getOrThrow(
        Option.fromUndefinedOr(both.search.continuation)
      ),
      task,
    },
    reverse: {
      continuation: Option.getOrThrow(
        Option.fromUndefinedOr(both.search.reverseContinuation)
      ),
      task,
    },
  };

  const next = update(both, Message.SearchInput({ text: "new query" })).model;

  expect(next.search.revision).toBe(both.search.revision + 1);
  expect(next.search.reversePhase).toBe("Idle");

  for (const direction of ["forward", "reverse"] as const) {
    const notice = SearchPageNotice.cases.Ready.make({
      direction,
      page: requests[direction],
      response,
    });

    expect(
      update(both, Message.ReceivedSearchPage({ notice })).commands?.map(
        (command) => command.name
      )
    ).toEqual(["CaptureSearchPage"]);
    const late = update(next, Message.ReceivedSearchPage({ notice }));
    expect(late.model).toBe(next);
    expect(late.commands ?? []).toEqual([]);

    const delayedAnchor = update(
      next,
      Message.ApplySearchPage({ anchor: Option.none(), notice })
    );

    expect(delayedAnchor.model).toBe(next);
    expect(delayedAnchor.commands ?? []).toEqual([]);
  }
});
