import { CalendarEvent } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { eventKey } from "../src/client/calendar-state.js";
import { view } from "../src/features/app.js";
import { dayInZone, visibleDays } from "../src/layout/navigation.js";
import {
  outsideSearchEvent,
  searchEmptyFixture,
  searchPartialFailureFixture,
  searchResponse,
  searchResultsFixture,
} from "./search-fixture.js";

const reviewResults = (partial = false): AppModel => {
  const base = partial ? searchPartialFailureFixture() : searchResultsFixture();
  const response = Option.getOrThrow(base.search.response);

  const long = CalendarEvent.make({
    ...outsideSearchEvent,
    title:
      "Planning the next calendar release with a deliberately long event title that stays readable in details and truncates safely in the search result list",
  });

  const combined = searchResponse([
    ...response.results.map((row) => row.event),
    long,
  ]);

  const model = {
    ...base,
    search: {
      ...base.search,
      response: Option.some({
        ...combined,
        accountFailures: response.accountFailures,
        failures: response.failures,
      }),
    },
  };

  return update(
    model,
    Message.SearchSelect({ goTo: false, key: eventKey(long) })
  ).model;
};

it.effect(
  "exports the actual search renderer with Today, off-grid details, a long title and a dark scene",
  () =>
    Effect.gen(function* searchArtifacts() {
      const platform = vi
        .spyOn(navigator, "platform", "get")
        .mockReturnValue("MacIntel");

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          platform.mockRestore();
        })
      );
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const results = reviewResults();

      const cases: readonly {
        readonly id: string;
        readonly model: AppModel;
      }[] = [
        { id: "results", model: results },
        { id: "empty", model: searchEmptyFixture() },
        { id: "partial-failure", model: reviewResults(true) },
        {
          id: "results-dark",
          model: {
            ...results,
            settings: { ...results.settings, theme: "dark" },
          },
        },
      ];

      const selectedDay = dayInZone(
        Option.getOrThrow(results.search.response).results.find(
          (row) => row.event.eventId === outsideSearchEvent.eventId
        )?.startMillis ?? 0,
        results.calendar.zone
      );

      expect(visibleDays(results.calendar.navigation)).not.toContain(
        selectedDay
      );

      for (const fixture of cases) {
        const rendered = yield* renderToString(
          { init: () => ({ model: fixture.model }), view },
          { isHydratable: false }
        );

        const dom = new DOMParser().parseFromString(rendered.html, "text/html");
        expect(dom.querySelector("#search-panel")).not.toBeNull();

        if (fixture.id === "empty") {
          expect(dom.querySelector("#search-results")?.textContent).toContain(
            "No results"
          );
        } else {
          expect(dom.querySelector("#search-today h2")?.textContent).toContain(
            "Today"
          );
          expect(dom.querySelector(".detail-panel")?.textContent).toContain(
            "Planning the next calendar release"
          );

          const title = dom.querySelector(
            '[data-search-event] strong[title^="Planning the next"]'
          );

          expect(title?.textContent).toContain(
            "truncates safely in the search result list"
          );
        }

        if (fixture.id === "partial-failure") {
          expect(dom.querySelectorAll("[data-search-failure]")).toHaveLength(2);
        }

        if (fixture.id === "results-dark") {
          expect(dom.querySelector(".theme-dark #search-panel")).not.toBeNull();
        }

        yield* fs.writeFileString(
          `../../.git/search-${fixture.id}-fixture.html`,
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="fixture-keyboard-platform" content="MacIntel"><style>${css}</style></head><body>${rendered.html}<script>const viewport=document.querySelector('#search-results');const today=document.querySelector('#search-today');if(viewport&&today)viewport.scrollTop=Math.max(0,today.offsetTop-viewport.offsetTop);document.querySelector('#search-query')?.focus({preventScroll:true});</script></body></html>`
        );
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
