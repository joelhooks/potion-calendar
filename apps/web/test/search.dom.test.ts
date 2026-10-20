import {
  CalendarReadFailure,
  NotConnected,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Predicate, Queue, Stream } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { eventKey } from "../src/client/calendar-state.js";
import { searchInteractions } from "../src/client/search/browser.js";
import { PrepareSearch } from "../src/client/search/commands.js";
import { view } from "../src/features/app.js";
import {
  outsideSearchEvent,
  searchEmptyFixture,
  searchPartialFailureFixture,
  searchResponse,
  searchResultsFixture,
} from "./search-fixture.js";

const render = (model: AppModel) =>
  renderToString(
    { init: () => ({ model }), view },
    { isHydratable: false }
  ).pipe(
    Effect.map(({ html }) => new DOMParser().parseFromString(html, "text/html"))
  );

const searchListenersReady = Effect.gen(function* searchListenersReady() {
  const registered = yield* Queue.unbounded<string>();
  const add = document.addEventListener.bind(document);

  const spy = vi
    .spyOn(document, "addEventListener")
    .mockImplementation((type, listener, options) => {
      add(type, listener, options);

      if (["click", "focusout"].includes(type)) {
        Queue.offerUnsafe(registered, type);
      }
    });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      spy.mockRestore();
    })
  );

  return {
    wait: Queue.take(registered).pipe(
      Effect.andThen(Queue.take(registered)),
      Effect.asVoid
    ),
  };
});

const mountedPanel = Effect.fn("test.mountedSearchPanel")(
  function* mountedPanel(model: AppModel) {
    const dom = yield* render(model);
    const element = dom.querySelector<HTMLElement>("#search-panel");

    if (element === null) {
      return yield* Effect.die(new Error("Missing search panel"));
    }

    const container = document.createElement("div");
    container.append(element);
    document.body.append(container);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        container.remove();
      })
    );

    return element;
  }
);

it.effect(
  "the search input has the specified browser controls, and loading is distinct from empty",
  () =>
    Effect.gen(function* searchStates() {
      const base = searchResultsFixture();

      const loading = yield* render({
        ...base,
        search: { ...base.search, phase: "Searching", response: Option.none() },
      });

      expect(loading.querySelector("#search-panel")?.textContent).toContain(
        "Searching"
      );
      expect(loading.querySelector("#search-panel")?.textContent).not.toContain(
        "No results"
      );
      const empty = yield* render(searchEmptyFixture());
      expect(empty.querySelector("#search-panel")?.textContent).toContain(
        "No results"
      );
      const input = empty.querySelector<HTMLInputElement>("#search-query");
      expect(input?.placeholder).toBe("Search events");
      expect(input?.getAttribute("spellcheck")).toBe("false");
      expect(input?.getAttribute("autocapitalize")).toBe("off");
      expect(input?.getAttribute("autocomplete")).toBe("off");
    })
);

it.effect(
  "results render dated sections, Today and a quiet initial-results signal without load-more controls",
  () =>
    Effect.gen(function* resultSections() {
      const dom = yield* render(searchResultsFixture());
      const panel = dom.querySelector("#search-panel");
      expect(panel?.querySelectorAll("[data-search-event]")).toHaveLength(4);
      expect(panel?.querySelector("#search-today h2")?.textContent).toContain(
        "Today"
      );
      expect(panel?.textContent).toContain(
        "Showing the first results for some calendars"
      );
      expect(
        [...(panel?.querySelectorAll("button") ?? [])].some((button) =>
          /load more/iu.test(button.textContent)
        )
      ).toBe(false);
      const base = searchResultsFixture();

      const past = searchResponse().results.filter(
        (result) => result.event.eventId === "a-review"
      );

      const pastDom = yield* render({
        ...base,
        search: {
          ...base.search,
          response: Option.some({ ...searchResponse(), results: past }),
        },
      });

      expect(pastDom.querySelector("#search-today")?.textContent).toContain(
        "No upcoming results"
      );
    })
);

it.effect(
  "account and calendar failures remain plain lines above surviving results",
  () =>
    Effect.gen(function* partialFailure() {
      const dom = yield* render(searchPartialFailureFixture());

      const lines = [...dom.querySelectorAll("[data-search-failure]")].map(
        (line) => line.textContent
      );

      expect(lines).toHaveLength(2);
      expect(lines).toEqual([
        "Couldn't search reconnect@example.test. Reconnect this account to include it.",
        "Couldn't search Shared calendar (owner@example.test).",
      ]);
      expect(lines.join(" ")).not.toMatch(/:\s*\.|revoked/iu);
      expect(dom.querySelectorAll("[data-search-event]")).toHaveLength(4);
    })
);

it.effect(
  "typed account, calendar and unknown failures never expose internal statuses or empty reasons",
  () =>
    Effect.gen(function* failureCopy() {
      const base = searchPartialFailureFixture();
      const response = Option.getOrThrow(base.search.response);
      const unknown = new NotConnected({ accountId: "opaque-account" });

      const cases = [
        {
          expected: [
            "Couldn't search reconnect@example.test. Reconnect this account to include it.",
          ],
          response: { ...response, failures: [] },
        },
        {
          expected: ["Couldn't search Shared calendar (owner@example.test)."],
          response: { ...response, accountFailures: [] },
        },
        {
          expected: [
            "Couldn't search one account.",
            "Couldn't search one calendar.",
          ],
          response: {
            ...response,
            accountFailures: [
              { accountId: "opaque-account", failure: unknown },
            ],
            failures: [
              new CalendarReadFailure({
                accountId: "opaque-account",
                calendarId: "opaque-calendar",
                cause: unknown,
              }),
            ],
          },
        },
      ];

      for (const entry of cases) {
        const dom = yield* render({
          ...base,
          search: { ...base.search, response: Option.some(entry.response) },
        });

        const lines = [...dom.querySelectorAll("[data-search-failure]")].map(
          (line) => line.textContent
        );

        expect(lines).toEqual(entry.expected);
        expect(lines.join(" ")).not.toMatch(/:\s*\.|revoked|opaque/iu);
      }
    })
);

it.effect(
  "an out-of-range selected result opens the same Event details panel without moving the grid",
  () =>
    Effect.gen(function* sharedDetails() {
      const base = searchResultsFixture();

      const model = {
        ...base,
        search: {
          ...base.search,
          response: Option.some(searchResponse([outsideSearchEvent])),
        },
      };

      const selected = update(
        model,
        Message.SearchSelect({ goTo: false, key: eventKey(outsideSearchEvent) })
      ).model;

      const dom = yield* render(selected);
      expect(dom.querySelector(".detail-panel")?.textContent).toContain(
        "Planning outside this week"
      );
      expect(dom.querySelector(".detail-actions")).not.toBeNull();
      expect(selected.calendar.navigation).toBe(model.calendar.navigation);
    })
);

it.effect(
  "the panel mount focuses the input and starts near Today, then restores a saved position",
  () =>
    Effect.gen(function* mountScroll() {
      const element = yield* mountedPanel(searchResultsFixture());
      const viewport = element.querySelector<HTMLElement>("#search-results");
      const today = element.querySelector<HTMLElement>("#search-today");

      const viewportElement = Option.getOrThrow(Option.fromNullishOr(viewport));
      const todayElement = Option.getOrThrow(Option.fromNullishOr(today));

      Object.defineProperty(viewportElement, "offsetTop", { value: 20 });
      Object.defineProperty(todayElement, "offsetTop", { value: 500 });
      yield* PrepareSearch({ position: Option.none() })
        .f(element, Stream.never)
        .pipe(Stream.take(1), Stream.runDrain);
      expect(document.activeElement?.id).toBe("search-query");
      expect(viewportElement.scrollTop).toBe(480);
      yield* PrepareSearch({ position: Option.some(310) })
        .f(element, Stream.never)
        .pipe(Stream.take(1), Stream.runDrain);
      expect(viewportElement.scrollTop).toBe(310);
    })
);

it.effect(
  "native result clicks carry Alt and the context menu exposes both selection actions",
  () =>
    Effect.gen(function* resultClicks() {
      const model = searchResultsFixture();
      const element = yield* mountedPanel(model);

      const button = Option.getOrThrow(
        Option.fromNullishOr(
          element.querySelector<HTMLButtonElement>("[data-search-event]")
        )
      );

      const ready = yield* searchListenersReady;

      const fiber = yield* searchInteractions().pipe(
        Stream.filter((message) => Predicate.isTagged(message, "SearchSelect")),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild
      );

      yield* ready.wait;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(
        new MouseEvent("click", { altKey: true, bubbles: true })
      );
      const clicks = yield* Fiber.join(fiber);
      expect(clicks.map((message) => message.goTo)).toEqual([false, true]);
      const key = button.dataset.searchEvent ?? "";

      const menu = yield* render(
        update(model, Message.SearchContext({ key })).model
      );

      expect(
        [...menu.querySelectorAll('[role="menuitem"]')].map(
          (item) => item.textContent
        )
      ).toEqual(["Select event", "Select and go to event"]);
    })
);

it.effect(
  "focus moving to Clear does not exit an empty search; ordinary empty blur does",
  () =>
    Effect.gen(function* clearFocus() {
      const element = yield* mountedPanel(searchEmptyFixture());

      const input = Option.getOrThrow(
        Option.fromNullishOr(
          element.querySelector<HTMLInputElement>("#search-query")
        )
      );

      const clear = Option.getOrThrow(
        Option.fromNullishOr(
          element.querySelector<HTMLButtonElement>("#search-clear")
        )
      );

      const ready = yield* searchListenersReady;

      const fiber = yield* searchInteractions().pipe(
        Stream.filter((message) => Predicate.isTagged(message, "SearchBlur")),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkChild
      );

      yield* ready.wait;
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: clear })
      );
      input.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: document.body,
        })
      );
      expect(yield* Fiber.join(fiber)).toEqual([Message.SearchBlur()]);
    })
);
