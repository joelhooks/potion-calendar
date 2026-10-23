import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { view } from "../src/features/app.js";
import { responseStyle } from "../src/layout/presentation.js";
import { chipColors } from "../src/layout/settings-colors.js";
import { rsvpChipFixture, rsvpEvent, rsvpScenes } from "./rsvp-chip-fixture.js";

it.effect.each(["light", "dark"] as const)(
  "%s actual chip render connects page-status and selected contrast roles without changing ordinary roles",
  (theme) =>
    Effect.gen(function* renderedRoles() {
      const scene = theme === "light" ? rsvpScenes[0] : rsvpScenes[1];
      const model = rsvpChipFixture(scene);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const parsed = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");
      const style = document.createElement("style");
      style.textContent = css;
      const root = document.createElement("div");
      root.innerHTML = rendered.html;
      document.head.append(style);
      document.body.append(root);

      try {
        for (const status of [
          "declined",
          "unanswered",
          "unconfirmed",
        ] as const) {
          const chip = root.querySelector<HTMLElement>(
            `.day-column .event-chip.status-${status}:not(.selected)`
          );

          expect(chip, status).not.toBeNull();

          const selected = root.querySelector<HTMLElement>(
            `.event-chip.status-${status}.selected`
          );

          expect(selected).not.toBeNull();

          const family = {
            declined: "#D06B65",
            unanswered: "#F4BE40",
            unconfirmed: "#5ECC89",
          }[status];

          expect(chip?.style.getPropertyValue("--event-status-text")).toBe(
            chipColors(family, theme).statusText
          );
          expect(getComputedStyle(chip ?? root).borderTopStyle).toBe("dashed");
          expect(getComputedStyle(selected ?? root).borderTopStyle).toBe(
            "dashed"
          );
          expect(getComputedStyle(chip ?? root).color).toBe(
            "var(--event-status-text)"
          );

          const pageRule = [...(style.sheet?.cssRules ?? [])].find(
            (rule) =>
              rule instanceof window.CSSStyleRule &&
              rule.selectorText.includes(".event-chip.status-declined")
          );

          expect(pageRule).toBeInstanceOf(window.CSSStyleRule);

          if (pageRule instanceof window.CSSStyleRule) {
            expect(chip?.matches(pageRule.selectorText)).toBe(true);
            expect(pageRule.style.getPropertyValue("background")).toBe(
              "var(--surface)"
            );
            expect(pageRule.style.getPropertyValue("border-color")).toBe(
              "var(--event-status-text)"
            );
          }
        }

        const selected = parsed.querySelector<HTMLElement>(
          ".event-chip.status-accepted.selected"
        );

        expect(
          selected?.style.getPropertyValue("--event-selected-primary-fill")
        ).toBe(chipColors("#985DF6", theme).selectedPrimaryFill);

        const normal = root.querySelector<HTMLElement>(
          ".event-chip.status-accepted:not(.selected)"
        );

        expect(normal?.style.getPropertyValue("--event-fill")).toBe(
          chipColors("#4986E8", theme).fill
        );
        expect(normal?.style.getPropertyValue("--event-color")).toBe(
          chipColors("#4986E8", theme).accent
        );
        expect(normal?.style.getPropertyValue("--event-status-text")).toBe("");
        expect(
          getComputedStyle(
            root.querySelector<HTMLElement>(
              ".event-chip.status-accepted.selected"
            ) ?? root
          ).color
        ).toBe("rgb(255, 255, 255)");
        expect(
          getComputedStyle(
            root.querySelector<HTMLElement>(
              ".event-chip.status-declined strong"
            ) ?? root
          ).textDecoration
        ).toBe("line-through");
        expect(
          getComputedStyle(
            root.querySelector<HTMLElement>(
              ".event-chip.status-unanswered strong"
            ) ?? root
          ).textDecoration
        ).not.toBe("line-through");
      } finally {
        root.remove();
        style.remove();
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "Month timed controls keep a transparent declaration and their compact calendar markers",
  () =>
    Effect.gen(function* monthStatusMarkers() {
      const model = rsvpChipFixture(rsvpScenes[2]);

      const rendered = yield* renderToString(
        { init: () => ({ model }), view },
        { isHydratable: false }
      );

      const parsed = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const fs = yield* FileSystem.FileSystem;
      const style = document.createElement("style");
      style.textContent = yield* fs.readFileString("src/client/style.css");
      document.head.append(style);

      try {
        const rule = [...(style.sheet?.cssRules ?? [])].find(
          (entry) =>
            entry instanceof window.CSSStyleRule &&
            entry.selectorText === ".month-item-timed .event-chip"
        );

        expect(rule).toBeInstanceOf(window.CSSStyleRule);

        const chips = [
          ...parsed.querySelectorAll<HTMLElement>(
            ".month-item-timed .event-chip:not(.selected)"
          ),
        ];

        expect(chips.length).toBeGreaterThan(0);

        if (rule instanceof window.CSSStyleRule) {
          expect(rule.style.getPropertyValue("background")).toBe("transparent");

          for (const chip of chips) {
            expect(chip.matches(rule.selectorText)).toBe(true);
            expect(chip.querySelector(".calendar-ribbon")).not.toBeNull();
          }
        }
      } finally {
        style.remove();
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "accepted attendee-derived tentative and unconfirmed statuses retain the existing response precedence",
  { count: Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 })) },
  ({ count }) =>
    Effect.sync(() => {
      const tentative = Array.from(
        { length: count },
        () => "tentative" as const
      );

      const declined = Array.from({ length: count }, () => "declined" as const);
      expect(
        responseStyle(rsvpEvent("all-tentative", 9, "accepted", "9", tentative))
      ).toBe("tentative");
      expect(
        responseStyle(rsvpEvent("all-declined", 9, "accepted", "9", declined))
      ).toBe("unconfirmed");
      expect(
        responseStyle(rsvpEvent("self-declined", 9, "declined", "9", tentative))
      ).toBe("declined");
      expect(
        responseStyle(
          rsvpEvent("self-unanswered", 9, "needsAction", "9", declined)
        )
      ).toBe("unanswered");
      expect(
        responseStyle(
          rsvpEvent("some-accepted", 9, "accepted", "9", [
            ...declined,
            "accepted",
          ])
        )
      ).toBe("accepted");
    })
);
