import { CalendarReadFailure, Provider } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import {
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Predicate,
  Queue,
  Ref,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import type { SearchProblem } from "../src/client/search/model.js";
import { SearchPageNotice } from "../src/client/search/page-model.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { searchQueryTask } from "../src/client/search/source.js";
import { view } from "../src/features/app.js";
import type { SearchRequest, SearchResponse } from "../src/search-contract.js";
import { searchResponse, unexpectedSearchClient } from "./search-fixture.js";
import { loadedSearch } from "./search-more-fixture.js";

it.effect(
  "replacing the real query page subscription interrupts both old reads and rejects late dispatch from its revision",
  () =>
    Effect.gen(function* replacePageSubscription() {
      const base = loadedSearch();
      const first = Option.getOrThrow(base.search.response);

      const model = {
        ...base,
        search: {
          ...base.search,
          response: Option.some({
            ...first,
            pageInfo: first.pageInfo.map((page) => ({
              ...page,
              olderCursor: { windowEnd: "2025-09-20T07:00:00Z" },
            })),
          }),
        },
      };

      const forward = update(model, Message.SearchMore()).model;
      const both = update(forward, Message.SearchOlder()).model;
      const task = Option.getOrThrow(searchQueryTask(both));

      const forwardPage = {
        continuation: Option.getOrThrow(
          Option.fromUndefinedOr(both.search.continuation)
        ),
        task,
      };

      const reversePage = {
        continuation: Option.getOrThrow(
          Option.fromUndefinedOr(both.search.reverseContinuation)
        ),
        task,
      };

      const oldForward = yield* Deferred.make<
        typeof SearchResponse.Type,
        typeof SearchProblem.Type
      >();

      const oldReverse = yield* Deferred.make<
        typeof SearchResponse.Type,
        typeof SearchProblem.Type
      >();

      const fresh = yield* Deferred.make<
        typeof SearchResponse.Type,
        typeof SearchProblem.Type
      >();

      const called = yield* Queue.unbounded<string>();

      const ready =
        yield* Queue.unbounded<typeof SearchPageNotice.cases.Ready.Type>();

      const interrupted = yield* Ref.make<readonly string[]>([]);

      const client = CalendarSearchClient.of({
        prefetch: unexpectedSearchClient.prefetch,
        search: (input) => {
          const direction =
            input.continuation?.pages[0]?._tag === "Reverse"
              ? "reverse"
              : "forward";

          const isOld = input.query === task.request.query;
          const oldRead = direction === "forward" ? oldForward : oldReverse;

          return Queue.offer(called, `${input.query}:${direction}`).pipe(
            Effect.andThen(Deferred.await(isOld ? oldRead : fresh)),
            Effect.onInterrupt(() =>
              Ref.update(interrupted, (values) => [
                ...values,
                `${input.query}:${direction}`,
              ])
            )
          );
        },
      });

      yield* Effect.gen(function* realSubscriptions() {
        const runtime = yield* SearchRuntime;

        const collect = (notice: typeof SearchPageNotice.Type) =>
          Predicate.isTagged(notice, "Ready")
            ? Queue.offer(ready, notice)
            : Effect.void;

        const previous = yield* runtime
          .observePages(task)
          .pipe(Stream.runForEach(collect), Effect.forkChild);

        yield* Effect.yieldNow;
        yield* runtime.dispatchPage("forward", forwardPage);
        expect(yield* Queue.take(called)).toBe(`${task.request.query}:forward`);
        yield* runtime.dispatchPage("reverse", reversePage);
        expect(yield* Queue.take(called)).toBe(`${task.request.query}:reverse`);
        yield* Fiber.interrupt(previous);
        expect((yield* Ref.get(interrupted)).toSorted()).toEqual(
          [
            `${task.request.query}:forward`,
            `${task.request.query}:reverse`,
          ].toSorted()
        );

        const nextTask = {
          ...task,
          request: { ...task.request, query: "fresh query" },
          revision: task.revision + 1,
        };

        yield* runtime
          .observePages(nextTask)
          .pipe(Stream.runForEach(collect), Effect.forkChild);
        yield* Effect.yieldNow;

        const refused = yield* runtime
          .dispatchPage("forward", forwardPage)
          .pipe(Effect.flip);

        expect(refused._tag).toBe("Transport");
        yield* runtime.dispatchPage("forward", {
          ...forwardPage,
          task: nextTask,
        });
        expect(yield* Queue.take(called)).toBe("fresh query:forward");

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
          window: first.window,
        };

        yield* Deferred.succeed(oldForward, response);
        yield* Deferred.succeed(oldReverse, response);
        expect(yield* Queue.poll(ready)).toEqual(Option.none());
        yield* Deferred.succeed(fresh, response);
        const received = yield* Queue.take(ready);
        expect(received.page.task).toEqual(nextTask);
        expect(yield* Queue.poll(ready)).toEqual(Option.none());
        expect(yield* Queue.poll(called)).toEqual(Option.none());
      }).pipe(
        Effect.provide(
          SearchRuntime.layer.pipe(
            Layer.provide(Layer.succeed(CalendarSearchClient, client))
          )
        ),
        Effect.scoped
      );
    })
);

it.effect.each(["forward", "reverse"] as const)(
  "%s retries retained A after B exhausts, never replays B, and settles the final exhausted calendar",
  (direction) =>
    Effect.gen(function* retainedCalendarRetryHistory() {
      const base = loadedSearch();
      const previous = Option.getOrThrow(base.search.response);

      const template = Option.getOrThrow(
        Option.fromUndefinedOr(previous.results[0])
      );

      const windowEnd = "2017-10-18T07:00:00Z";

      const info = (calendarId: string, more: boolean, token?: string) => ({
        accountId: "work",
        calendarId,
        forwardHasMore: direction === "forward" && more,
        forwardNextPageToken: direction === "forward" ? token : undefined,
        olderCursor:
          direction === "reverse" && more
            ? { pageToken: token, windowEnd }
            : undefined,
        olderHasMore: direction === "reverse" ? more : undefined,
      });

      const row = (eventId: string, date: string) => {
        const start = DateTime.makeUnsafe(date);
        const end = DateTime.add(start, { hours: 1 });

        return {
          ...template,
          calendar: {
            ...template.calendar,
            calendarId: "second",
            primary: false,
            title: "Second calendar",
          },
          endMillis: DateTime.toEpochMillis(end),
          event: {
            ...template.event,
            calendarId: "second",
            end: { dateTime: DateTime.formatIso(end) },
            eventId,
            start: { dateTime: DateTime.formatIso(start) },
            title: eventId,
          },
          startMillis: DateTime.toEpochMillis(start),
        };
      };

      let model: AppModel = {
        ...base,
        calendar: {
          ...base.calendar,
          calendars: [
            ...base.calendar.calendars,
            {
              ...template.calendar,
              calendarId: "second",
              primary: false,
              title: "Second calendar",
            },
          ],
        },
        search: {
          ...base.search,
          response: Option.some({
            ...previous,
            pageInfo: [
              info("primary", true, "A-retained"),
              info("second", true, "B-retained"),
            ],
          }),
          revision: base.search.revision + 1,
        },
      };

      const task = Option.getOrThrow(searchQueryTask(model));

      const firstRead = yield* Deferred.make<
        typeof SearchResponse.Type,
        typeof SearchProblem.Type
      >();

      const secondRead = yield* Deferred.make<
        typeof SearchResponse.Type,
        typeof SearchProblem.Type
      >();

      const retryRead = yield* Deferred.make<
        typeof SearchResponse.Type,
        typeof SearchProblem.Type
      >();

      const waiting = [firstRead, secondRead, retryRead];
      const started = yield* Queue.unbounded<readonly string[]>();
      const notices = yield* Queue.unbounded<typeof SearchPageNotice.Type>();
      const calls = yield* Ref.make<readonly (readonly string[])[]>([]);

      const client = CalendarSearchClient.of({
        prefetch: unexpectedSearchClient.prefetch,
        search: Effect.fn("test.search.readHistoryPage")(
          function* readHistoryPage(input: typeof SearchRequest.Type) {
            const calendars =
              input.continuation?.pages.map((page) => page.calendarId) ?? [];

            const requests = yield* Ref.updateAndGet(calls, (values) => [
              ...values,
              calendars,
            ]);

            yield* Queue.offer(started, calendars);
            const pending = waiting[requests.length - 1];

            if (pending === undefined) {
              return yield* Effect.die(
                new Error(
                  "Unexpected repeated provider read in retained-cursor history"
                )
              );
            }

            return yield* Deferred.await(pending);
          }
        ),
      });

      yield* Effect.gen(function* scopedRetryHistory() {
        const runtime = yield* SearchRuntime;
        yield* runtime.observePages(task).pipe(
          Stream.runForEach((notice) => Queue.offer(notices, notice)),
          Effect.forkChild
        );
        yield* TestClock.adjust(0);

        const ready = Stream.fromQueue(notices).pipe(
          Stream.filter(SearchPageNotice.guards.Ready),
          Stream.runHead,
          Effect.map(Option.getOrThrow)
        );

        const dispatch = Effect.fn("test.search.dispatchRetainedPage")(
          function* dispatch(message: AppMessage) {
            const next = update(model, message);
            expect(next.commands?.map((command) => command.name)).toEqual([
              "DispatchSearchPage",
            ]);
            ({ model } = next);

            const continuation = Option.getOrThrow(
              Option.fromUndefinedOr(
                direction === "forward"
                  ? model.search.continuation
                  : model.search.reverseContinuation
              )
            );

            const page = {
              continuation,
              task: Option.getOrThrow(searchQueryTask(model)),
            };

            yield* runtime.dispatchPage(direction, page);

            return page;
          }
        );

        const apply = Effect.fn("test.search.applyRetainedPage")(
          function* apply() {
            const notice = yield* ready;
            expect(
              update(
                model,
                Message.ReceivedSearchPage({ notice })
              ).commands?.map((command) => command.name)
            ).toEqual(["CaptureSearchPage"]);

            const next = update(
              model,
              Message.ApplySearchPage({ anchor: Option.none(), notice })
            );

            expect(next.commands?.map((command) => command.name)).toEqual([
              "RestoreSearchAnchor",
            ]);
            ({ model } = next);

            return notice;
          }
        );

        const more =
          direction === "forward"
            ? Message.SearchMore()
            : Message.SearchOlder();

        const retry =
          direction === "forward"
            ? Message.SearchRetryCalendar({
                accountId: "work",
                calendarId: "primary",
              })
            : Message.SearchRetryOlderCalendar({
                accountId: "work",
                calendarId: "primary",
              });

        const firstPage = yield* dispatch(more);
        expect(yield* Queue.take(started)).toEqual(["primary", "second"]);
        yield* Deferred.succeed(firstRead, {
          ...previous,
          failures: [
            new CalendarReadFailure({
              accountId: "work",
              calendarId: "primary",
              cause: new Provider({
                message: "A failed while B succeeded",
                operation: "searchEvents",
                status: 503,
              }),
            }),
          ],
          pageInfo: [info("second", true, "B-next")],
          results: [
            row(
              "B-first",
              direction === "reverse"
                ? "2017-08-01T16:00:00Z"
                : "2026-11-19T17:00:00Z"
            ),
          ],
        });
        yield* apply();
        yield* dispatch(more);
        expect(yield* Queue.take(started)).toEqual(["second"]);
        yield* Deferred.succeed(secondRead, {
          ...previous,
          failures: [],
          pageInfo: [info("second", false)],
          results: [
            row(
              "B-last",
              direction === "reverse"
                ? "2017-08-02T16:00:00Z"
                : "2026-11-20T17:00:00Z"
            ),
          ],
        });
        yield* apply();

        const beforeRetry = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        expect(beforeRetry.html).not.toContain("data-search-history-horizon");
        expect(
          Option.getOrThrow(model.search.response).failures.map(
            (failure) => failure.calendarId
          )
        ).toEqual(["primary"]);
        const waitingMore = update(model, more);
        expect(waitingMore.model).toBe(model);
        expect(waitingMore.commands ?? []).toEqual([]);

        const oldBRows = Option.getOrThrow(
          model.search.response
        ).results.filter((result) => result.event.calendarId === "second");

        expect(oldBRows.map((result) => result.event.eventId)).toEqual([
          "B-first",
          "B-last",
        ]);
        const retryPage = yield* dispatch(retry);
        expect(retryPage.continuation.pages).toEqual(
          firstPage.continuation.pages.filter(
            (page) => page.calendarId === "primary"
          )
        );
        yield* TestClock.adjust(0);
        expect(yield* Queue.poll(started)).toEqual(Option.some(["primary"]));
        const duplicate = update(model, retry);
        expect(duplicate.model).toBe(model);
        expect(duplicate.commands ?? []).toEqual([]);
        yield* runtime.dispatchPage(direction, retryPage);
        yield* TestClock.adjust(0);
        expect(yield* Queue.poll(started)).toEqual(Option.none());
        expect(yield* Ref.get(calls)).toEqual([
          ["primary", "second"],
          ["second"],
          ["primary"],
        ]);
        yield* Deferred.succeed(retryRead, {
          ...previous,
          failures: [],
          pageInfo: [info("primary", false)],
          results: [],
        });
        const finalNotice = yield* apply();
        expect(finalNotice.response.results).toEqual([]);
        expect(
          Option.getOrThrow(model.search.response).results.filter(
            (result) => result.event.calendarId === "second"
          )
        ).toEqual(oldBRows);
        expect(Option.getOrThrow(model.search.response).failures).toEqual([]);

        const settled = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        expect(settled.html).not.toMatch(/Loading (?:more|older)|Retry/u);
        expect(settled.html).not.toContain("data-search-retry-calendar");

        if (direction === "reverse") {
          expect(settled.html).toContain("data-search-history-horizon");
          expect(settled.html).toContain("Searched back to Oct 2016");
        } else {
          expect(settled.html).not.toContain("data-search-history-horizon");
        }

        const noCursor = update(model, more);
        expect(noCursor.model).toBe(model);
        expect(noCursor.commands ?? []).toEqual([]);
        yield* runtime.dispatchPage(direction, {
          ...retryPage,
          continuation: { ...retryPage.continuation, pages: [] },
        });
        yield* TestClock.adjust(0);
        expect(yield* Queue.poll(started)).toEqual(Option.none());

        const stale = yield* runtime
          .dispatchPage(direction, {
            ...retryPage,
            task: { ...retryPage.task, revision: task.revision - 1 },
          })
          .pipe(Effect.flip);

        expect(stale._tag).toBe("Transport");
        expect(yield* Ref.get(calls)).toHaveLength(3);
      }).pipe(
        Effect.provide(
          SearchRuntime.layer.pipe(
            Layer.provide(Layer.succeed(CalendarSearchClient, client))
          )
        ),
        Effect.scoped
      );
    })
);
