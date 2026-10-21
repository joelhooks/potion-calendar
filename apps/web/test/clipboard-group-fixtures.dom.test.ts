import type { CreateEventInput } from "@calendar/calendar/contracts";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { renderToString } from "foldkit/experimental/server";

import {
  ClipboardAnchor,
  ClipboardView,
} from "../src/client/clipboard/model.js";
import { view } from "../src/features/app.js";
import {
  collectGroupArtifact,
  GroupArtifactState,
} from "./clipboard-group-artifact-fixture.js";
import { groupFixtureProof } from "./clipboard-group-proof.js";

const panelSelectors = {
  dst: ".clipboard-results",
  guests: "#clipboard-guests",
  mixed: ".clipboard-toast",
  partial: ".clipboard-results",
  "success-month": ".clipboard-results",
  "success-month-all-day": ".clipboard-results",
  "success-week": ".clipboard-results",
};

const assertCreatedChips = (dom: Document, ids: readonly string[]) => {
  for (const id of ids) {
    expect(
      [...dom.querySelectorAll<HTMLElement>("[data-event-key]")].some(
        (chip) => chip.dataset.eventKey?.includes(id) === true
      )
    ).toBe(true);
  }
};

const fixtureViewportWidth = (width: number) =>
  width - (width <= 1000 ? 445 : 520);

const assertSettledSidebar = (dom: Document) => {
  expect(dom.querySelector(".sidebar-command-space")).not.toBeNull();
  expect(dom.querySelector(".sidebar")?.textContent).not.toContain(
    "Loading events"
  );
};

const fixtureThemes = (
  kind: typeof GroupArtifactState.Type,
  width: number
): readonly ("light" | "dark")[] => {
  if (kind === "success-month-all-day") {
    return width === 1440 ? ["light"] : ["dark"];
  }

  return ["light", "dark"];
};

const assertMonthAnchor = (
  kind: typeof GroupArtifactState.Type,
  artifact: {
    readonly anchor: typeof ClipboardAnchor.Type;
    readonly calls: readonly (typeof CreateEventInput.Type)[];
  }
) => {
  if (kind === "success-month" || kind === "success-month-all-day") {
    expect(artifact.anchor).toEqual(
      ClipboardAnchor.cases.AllDay.make({ date: "2026-10-21", origin: "month" })
    );
  }

  if (kind === "success-month") {
    for (const [index, call] of artifact.calls.entries()) {
      expect(call.event.start).toEqual({
        dateTime: `2026-10-21T${20 - index * 2}:00:00.000Z`,
        timeZone: "America/Los_Angeles",
      });
    }
  }

  if (kind === "success-month-all-day") {
    for (const [index, call] of artifact.calls.entries()) {
      expect(call.event.start).toEqual({ date: `2026-10-${23 - index}` });
      expect(call.event.end).toEqual({ date: `2026-10-${24 - index}` });
    }
  }
};

it.effect.each(GroupArtifactState.literals)(
  "exports actual root group clipboard state %s with shared CSS at both widths and themes",
  (kind) =>
    Effect.gen(function* groupArtifacts() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const artifact = yield* collectGroupArtifact(kind);
      assertMonthAnchor(kind, artifact);
      expect(artifact.calls.every((call) => call.sendUpdates === "none")).toBe(
        true
      );

      if (kind === "guests") {
        expect(ClipboardView.guards.Guests(artifact.model.clipboard.view)).toBe(
          true
        );
        expect(artifact.calls).toHaveLength(0);
      } else if (kind === "mixed") {
        expect(
          Option.getOrThrow(artifact.model.clipboard.view.toast).message
        ).toBe("Copy timed and all-day events separately. Nothing was copied.");
        expect(artifact.calls).toHaveLength(0);
      } else {
        const projection = yield* Effect.succeed(
          artifact.model.clipboard.view
        ).pipe(
          Effect.filterOrElse(ClipboardView.guards.Results, () =>
            Effect.die("Group fixture has no actual result")
          )
        );

        expect(projection.succeeded).toBe(
          kind === "partial" || kind === "dst" ? 2 : 3
        );
        expect(projection.issues).toHaveLength(
          kind === "partial" || kind === "dst" ? 1 : 0
        );

        if (kind === "dst") {
          expect(projection.issues[0]?.title).toBe("Beta");
          expect(projection.issues[0]?.reason).toContain(
            "Beta would start at 2:30am on Mar 8, which doesn't exist when clocks spring forward"
          );
          expect(artifact.calls).toHaveLength(2);
        }
      }

      for (const width of [1440, 900]) {
        for (const theme of fixtureThemes(kind, width)) {
          const model = {
            ...artifact.model,
            calendar: {
              ...artifact.model.calendar,
              viewportWidth: fixtureViewportWidth(width),
            },
            settings: { ...artifact.model.settings, theme },
          };

          const rendered = yield* renderToString(
            { init: () => ({ model }), view },
            { isHydratable: false }
          );

          const dom = new DOMParser().parseFromString(
            rendered.html,
            "text/html"
          );

          const selector = panelSelectors[kind];
          expect(dom.querySelector(selector)).not.toBeNull();

          if (kind === "guests") {
            expect(
              dom.querySelector("#clipboard-guests")?.textContent
            ).toContain("One guest choice applies to the whole group.");
          }

          if (kind.startsWith("success-")) {
            expect(
              dom.querySelector(".clipboard-results")?.textContent
            ).toContain("Pasted 3 events");

            assertCreatedChips(
              dom,
              artifact.calls.map((call) => call.id)
            );
          }

          if (kind === "partial") {
            expect(
              dom.querySelector(".clipboard-results")?.textContent
            ).toContain("Couldn't paste 1 event");
            expect(
              dom.querySelector(".clipboard-results li")?.textContent
            ).toContain("Gamma:");
          }

          assertSettledSidebar(dom);

          const proof = groupFixtureProof(
            selector,
            artifact.calls.map((call) => call.id)
          );

          yield* fs.writeFileString(
            `../../.git/clipboard-group-${kind}-${theme}-${width}-fixture.html`,
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fixture-viewport" content="${width}x900"><title>Group clipboard ${kind} ${theme} ${width}</title><style>${css}</style></head><body>${rendered.html}<script>${proof}</script></body></html>`
          );
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);
