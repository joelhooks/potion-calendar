import { CalendarReadFailure, Provider } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Queue, Schema, Stream } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import { searchInteractions } from "../src/client/search/browser.js";
import { SearchNotice, SearchProblem } from "../src/client/search/model.js";
import { searchTask } from "../src/client/search/source.js";
import { view } from "../src/features/app.js";
import {
  loadedSearch,
  searchMoreFixture,
  partiallyFailedSearchPair,
} from "./search-more-fixture.js";

it.effect(
  "actual capture-phase near-bottom events trigger within one viewport and repeated events cannot start another outstanding page",
  () =>
    Effect.gen(function* nearBottomSearch() {
      const viewport = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("div");
          element.id = "search-results";
          document.body.append(element);

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
          })
      );

      let top = 799;
      Object.defineProperties(viewport, {
        clientHeight: { configurable: true, get: () => 600 },
        scrollHeight: { configurable: true, get: () => 2000 },
        scrollTop: { configurable: true, get: () => top },
      });
      const registered = yield* Queue.unbounded<true>();
      const add = document.addEventListener.bind(document);

      const spy = vi
        .spyOn(document, "addEventListener")
        .mockImplementation((type, listener, options) => {
          add(type, listener, options);

          if (
            type === "scroll" &&
            Schema.is(Schema.Struct({ capture: Schema.Literal(true) }))(options)
          ) {
            Queue.offerUnsafe(registered, true);
          }
        });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          spy.mockRestore();
        })
      );
      const arrived = yield* Queue.unbounded<ReturnType<typeof update>>();
      const initial = loadedSearch();
      let model = initial;
      yield* searchInteractions().pipe(
        Stream.runForEach((message) =>
          Effect.gen(function* processScroll() {
            const result = update(model, message);
            ({ model } = result);
            yield* Queue.offer(arrived, result);
          })
        ),
        Effect.forkScoped
      );
      yield* Queue.take(registered);
      viewport.dispatchEvent(new Event("scroll"));
      top = 800;
      viewport.dispatchEvent(new Event("scroll"));
      const first = yield* Queue.take(arrived);
      expect(first.model.search.phase).toBe("LoadingMore");
      expect(first.model.search.revision).toBe(initial.search.revision);
      expect(first.commands?.map((command) => command.name)).toEqual([
        "DispatchSearchPage",
      ]);
      expect(first.model.search.response).toEqual(initial.search.response);
      viewport.dispatchEvent(new Event("scroll"));
      const repeated = yield* Queue.take(arrived);
      expect(repeated.model.search.revision).toBe(first.model.search.revision);
      expect(Option.getOrThrow(repeated.model.search.response).results).toEqual(
        Option.getOrThrow(initial.search.response).results
      );
      expect(yield* Queue.poll(arrived)).toEqual(Option.none());
    })
);

it.effect(
  "the real application renders a token-backed load-more control, retains rows while pending and distinguishes exhaustion and retry",
  () =>
    Effect.gen(function* searchPageControls() {
      for (const scenario of [
        "more-available",
        "loading-more",
        "exhausted",
        "partial-failure",
      ] as const) {
        const model = searchMoreFixture(scenario, "light");

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        const controls = document.querySelector(
          '[data-search-page-controls="true"]'
        );

        const buttons = [...(controls?.querySelectorAll("button") ?? [])];

        const more = buttons.find(
          (button) => button.textContent === "Load more"
        );

        expect(document.querySelectorAll("[data-search-event]")).toHaveLength(
          1
        );
        expect(controls).not.toBeNull();
        expect(controls?.getAttribute("role")).toBe("status");
        expect(controls?.getAttribute("aria-live")).toBe("polite");
        expect(more === undefined).toBe(
          scenario === "exhausted" || scenario === "partial-failure"
        );

        if (more !== undefined) {
          expect(more.disabled).toBe(scenario === "loading-more");
        }

        expect(controls?.textContent?.includes("Loading more")).toBe(
          scenario === "loading-more"
        );
        expect(controls?.textContent?.includes("No more results")).toBe(
          scenario === "exhausted"
        );

        const retries = [
          ...document.querySelectorAll<HTMLButtonElement>(
            "[data-search-retry-calendar]"
          ),
        ];

        expect(retries).toHaveLength(scenario === "partial-failure" ? 1 : 0);

        for (const retry of retries) {
          expect(retry.textContent).toBe("Retry");
          expect(retry.getAttribute("aria-label")).toBe(
            "Retry Work (owner@example.test)"
          );
          expect(retry.previousElementSibling?.textContent).toBe(
            "Couldn't load more from Work (owner@example.test)."
          );
          expect(retry.closest("[data-search-page-controls]")).toBe(controls);
          expect(retry.closest("[data-search-failure='true']")).toBe(
            retry.parentElement
          );
        }

        expect(
          document.querySelector("[data-search-history-controls]")?.textContent
        ).toContain("Some older results aren't shown.");
        expect(controls?.textContent).not.toMatch(/older|Searched back/iu);
      }
    })
);

it.effect(
  "each failed calendar owns an adjacent Retry with its own account-qualified name and calendar-only request",
  () =>
    Effect.gen(function* calendarRetries() {
      const initial = loadedSearch();

      const calendars = initial.calendar.calendars
        .filter((calendar) => calendar.accountId === "work")
        .slice(0, 2);

      expect(calendars).toHaveLength(2);
      const response = Option.getOrThrow(initial.search.response);

      const model = {
        ...initial,
        search: {
          ...initial.search,
          response: Option.some({
            ...response,
            failures: calendars.map(
              (calendar) =>
                new CalendarReadFailure({
                  accountId: calendar.accountId,
                  calendarId: calendar.calendarId,
                  cause: new Provider({
                    message: "Fake failed calendar",
                    operation: "events.list",
                    status: 500,
                  }),
                })
            ),
          }),
        },
      };

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document.querySelectorAll("[data-search-retry-calendar]")
      ).toHaveLength(2);

      for (const calendar of calendars) {
        const ref = {
          accountId: calendar.accountId,
          calendarId: calendar.calendarId,
        };

        const key = JSON.stringify([ref.accountId, ref.calendarId]);

        const retry = document.querySelector<HTMLButtonElement>(
          `[data-search-retry-calendar='${key}']`
        );

        expect(retry?.textContent).toBe("Retry");
        expect(retry?.getAttribute("aria-label")).toBe(
          `Retry ${calendar.title} (owner@example.test)`
        );
        expect(retry?.previousElementSibling?.textContent).toBe(
          `Couldn't search ${calendar.title} (owner@example.test).`
        );
        expect(retry?.disabled).toBe(false);
        expect(retry?.closest("[data-search-page-controls]")).toBeNull();
        const next = update(model, Message.SearchRetryCalendar(ref)).model;
        expect(
          Option.getOrThrow(searchTask(next)).request.continuation?.pages.map(
            (page) => ({
              accountId: page.accountId,
              calendarId: page.calendarId,
            })
          )
        ).toEqual([ref]);
        expect(next.search.response).toEqual(model.search.response);
      }
    })
);

it.effect(
  "continuation failures remain in the polite footer beside another calendar's Load more with one shared pending gate",
  () =>
    Effect.gen(function* footerFailure() {
      const failed = partiallyFailedSearchPair();
      const pending = update(failed, Message.SearchMore());
      expect(pending.commands?.map((command) => command.name)).toEqual([
        "DispatchSearchPage",
      ]);

      for (const model of [failed, pending.model]) {
        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const document = new DOMParser().parseFromString(
          rendered.html,
          "text/html"
        );

        const footer = document.querySelector("[data-search-page-controls]");
        expect(footer?.getAttribute("role")).toBe("status");
        expect(footer?.getAttribute("aria-live")).toBe("polite");
        expect(
          document.querySelectorAll("#search-results > [data-search-failure]")
        ).toHaveLength(0);
        expect(document.querySelectorAll("[data-search-event]")).toHaveLength(
          2
        );

        const retry = footer?.querySelector<HTMLButtonElement>(
          "[data-search-retry-calendar]"
        );

        expect(retry?.previousElementSibling?.textContent).toBe(
          "Couldn't load more from Work (owner@example.test)."
        );
        expect(retry?.getAttribute("aria-label")).toBe(
          "Retry Work (owner@example.test)"
        );

        const more = [...(footer?.querySelectorAll("button") ?? [])].find(
          (button) => button.textContent === "Load more"
        );

        expect(more).toBeDefined();
        expect(more?.disabled).toBe(model.search.phase === "LoadingMore");
        expect(retry?.disabled).toBe(model.search.phase === "LoadingMore");
        expect(footer?.querySelector("[autofocus]")).toBeNull();
      }
    })
);

it.effect(
  "a continuation transport failure is announced with its explicit retry in the footer without replacing earlier rows",
  () =>
    Effect.gen(function* footerTransport() {
      const initial = loadedSearch();
      const pending = update(initial, Message.SearchMore()).model;
      const task = Option.getOrThrow(searchTask(pending));

      const received = update(
        pending,
        Message.ReceivedSearch({
          notice: SearchNotice.cases.Failed.make({
            problem: SearchProblem.cases.Transport.make({
              message: "Connection lost while loading more.",
            }),
            task,
          }),
        })
      );

      const { model } = received;
      expect(received.commands ?? []).toHaveLength(0);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const footer = document.querySelector("[data-search-page-controls]");
      expect(footer?.getAttribute("aria-live")).toBe("polite");
      expect(footer?.textContent).toContain(
        "Connection lost while loading more."
      );
      expect(footer?.textContent).toContain("Retry loading more");
      expect(
        document.querySelectorAll("#search-results > [data-search-failure]")
      ).toHaveLength(0);
      expect(document.querySelectorAll("[data-search-event]")).toHaveLength(1);
      expect(model.search.response).toEqual(initial.search.response);
    })
);
