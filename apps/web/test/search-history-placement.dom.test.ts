import { CalendarReadFailure, Provider } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { AppModel } from "../src/client/app.js";
import { SearchProblem } from "../src/client/search/model.js";
import { view } from "../src/features/app.js";
import {
  searchHistoryFixture,
  searchHistoryScenes,
} from "./search-history-fixture.js";

for (const scene of searchHistoryScenes) {
  for (const phase of ["pending", "after"] as const) {
    it.effect(
      `older ${phase} ${scene.scene} ${scene.width} owns the top region and never leaks into forward controls`,
      () =>
        Effect.gen(function* olderDirectionPlacement() {
          const fixture = searchHistoryFixture(scene);
          const model = fixture[phase];

          const rendered = yield* renderToString(
            { init: () => ({ model }), view },
            { isHydratable: false }
          );

          const document = new DOMParser().parseFromString(
            rendered.html,
            "text/html"
          );

          const viewport = document.querySelector("#search-results");

          const history = viewport?.querySelector(
            '[data-search-history-controls="true"]'
          );

          const footer = viewport?.querySelector(
            '[data-search-page-controls="true"]'
          );

          const section = viewport?.querySelector("section");

          expect(history).not.toBeNull();
          expect(history?.getAttribute("role")).toBe("status");
          expect(history?.getAttribute("aria-live")).toBe("polite");

          if (
            history === null ||
            history === undefined ||
            section === null ||
            section === undefined
          ) {
            throw new Error(
              "Missing actual history region or dated result section"
            );
          }

          expect(history.compareDocumentPosition(section)).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING
          );
          expect(footer?.textContent).not.toMatch(/older|Searched back/iu);

          if (phase === "pending") {
            expect(history.textContent).toContain("Loading older results");
          } else if (scene.scene === "horizon") {
            expect(
              history.querySelector("[data-search-history-horizon]")
                ?.textContent
            ).toBe("Searched back to Oct 2016");
          } else {
            expect(history.textContent).toContain("Load older results");
          }
        })
    );
  }
}

it.effect.each(["calendar", "both", "transport"] as const)(
  "older %s failure and its retry stay at the top without stealing the forward failure recipient",
  (mode) =>
    Effect.gen(function* directionalFailurePlacement() {
      const [scene] = searchHistoryScenes;
      const { before } = searchHistoryFixture(scene);

      const response = Option.getOrThrow(before.search.response);
      const ref = { accountId: "work", calendarId: "primary" };

      const failure = new CalendarReadFailure({
        ...ref,
        cause: new Provider({
          message: "Fixture direction failure",
          operation: "searchEvents",
          status: 503,
        }),
      });

      const ledger = { accountFailures: [], failures: [failure] };

      const model: AppModel = {
        ...before,
        search: {
          ...before.search,
          continuationFailures: mode === "both" ? [ref] : [],
          forwardFailures:
            mode === "both" ? Option.some(ledger) : Option.none(),
          response: Option.some({
            ...response,
            failures: mode === "transport" ? [] : [failure],
          }),
          reverseFailures:
            mode === "transport" ? Option.none() : Option.some(ledger),
          reversePhase: mode === "transport" ? "MoreFailed" : "Ready",
          reverseProblem:
            mode === "transport"
              ? Option.some(
                  SearchProblem.cases.Transport.make({
                    message: "Could not load older search results.",
                  })
                )
              : Option.none(),
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

      const top = document.querySelector("[data-search-history-controls]");

      const footer = document.querySelector("[data-search-page-controls]");

      expect(top).not.toBeNull();
      expect(footer?.textContent ?? "").not.toMatch(/older|Searched back/iu);

      if (mode === "transport") {
        expect(top?.textContent).toContain(
          "Could not load older search results."
        );
        expect(top?.textContent).toContain("Retry loading older results");
      } else {
        expect(
          top?.querySelector("[data-search-retry-calendar]")
        ).not.toBeNull();
        expect(top?.textContent).toContain("Couldn't load more from Work");
        expect(
          Boolean(footer?.querySelector("[data-search-retry-calendar]"))
        ).toBe(mode === "both");
      }
    })
);

it.effect(
  "the top history horizon stays visible when only the independent forward direction has failed",
  () =>
    Effect.gen(function* independentHorizonPlacement() {
      const [, scene] = searchHistoryScenes;
      const { after } = searchHistoryFixture(scene);

      const response = Option.getOrThrow(after.search.response);
      const ref = { accountId: "work", calendarId: "primary" };

      const failure = new CalendarReadFailure({
        ...ref,
        cause: new Provider({
          message: "Forward fixture refusal",
          operation: "searchEvents",
          status: 503,
        }),
      });

      const model: AppModel = {
        ...after,
        search: {
          ...after.search,
          continuationFailures: [ref],
          forwardFailures: Option.some({
            accountFailures: [],
            failures: [failure],
          }),
          response: Option.some({ ...response, failures: [failure] }),
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
        document.querySelector(
          "[data-search-history-controls] [data-search-history-horizon]"
        )?.textContent
      ).toBe("Searched back to Oct 2016");
      expect(
        document.querySelector("[data-search-page-controls]")?.textContent
      ).toContain("Couldn't load more from Work");
    })
);
