import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { mountAccountLinksCss } from "./account-links-fixture.js";

it.effect.each([390, 430, 640, 641, 900, 1440])(
  "account links use full-width flex rows under the actual width-matched CSS at %s px",
  (width) =>
    Effect.gen(function* accountRowPolicy() {
      const root = yield* mountAccountLinksCss("conferencing", width);
      const links = [...root.querySelectorAll(".settings-account-link")];
      expect(links).toHaveLength(2);

      for (const link of links) {
        const style = getComputedStyle(link);
        expect(style.display).toBe("flex");
        expect(style.justifyContent).toBe("space-between");
        expect(style.alignItems).toBe("center");
        expect(
          Number(style.minHeight.replace("px", ""))
        ).toBeGreaterThanOrEqual(44);
        expect(style.textDecoration).toBe("none");
      }
    })
);

it.effect.each([390, 430, 900, 1440])(
  "account email and decorative arrow form separate flex items with an email-only accessible label at %s px",
  (width) =>
    Effect.gen(function* separateAccountItems() {
      const root = yield* mountAccountLinksCss("conferencing", width);
      const links = [...root.querySelectorAll(".settings-account-link")];
      const expected = ["owner@example.test", "personal@example.test"];
      expect(links).toHaveLength(expected.length);

      for (const [index, link] of links.entries()) {
        const arrow = link.querySelector(':scope > span[aria-hidden="true"]');
        expect(arrow?.textContent?.trim()).toBe("→");
        expect(link.firstChild?.nodeType).toBe(Node.TEXT_NODE);
        expect(link.firstChild?.textContent).toBe(expected[index]);
        expect(link.childNodes).toHaveLength(2);
        expect(link.getAttribute("href")).toMatch(/^\/settings\/calendar\//u);
      }
    })
);

it.effect.each([390, 430])(
  "other phone anchors keep their inline-flex 44 px touch policy at %s px",
  (width) =>
    Effect.gen(function* ordinaryPhoneLinkPolicy() {
      const root = yield* mountAccountLinksCss("conferencing", width);
      const anchor = document.createElement("a");
      anchor.href = "https://example.test/guide";
      anchor.textContent = "Guide";
      const body = root.querySelector(".phone-sheet-body");
      expect(body).not.toBeNull();
      body?.append(anchor);
      const style = getComputedStyle(anchor);
      expect(style.display).toBe("inline-flex");
      expect(style.minWidth).toBe("44px");
      expect(style.minHeight).toBe("44px");
    })
);

it.effect.each([390, 430])(
  "the actual Calendars account page retains its separate row and navigation policies at %s px",
  (width) =>
    Effect.gen(function* calendarAccountPolicy() {
      const root = yield* mountAccountLinksCss("calendar", width);
      const rows = [...root.querySelectorAll(".settings-calendar-row")];
      expect(rows.length).toBeGreaterThan(0);
      expect(root.querySelector(".settings-account-link")).toBeNull();

      for (const row of rows) {
        expect(getComputedStyle(row).display).toBe("flex");
      }

      expect(
        root.querySelectorAll(".settings-account-nav").length
      ).toBeGreaterThan(0);
    })
);
