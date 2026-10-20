import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { afterEach, vi } from "vitest";

import {
  clipboardAnchorAt,
  trackClipboardPointer,
} from "../src/client/clipboard/anchor.js";
import type {
  ClipboardGridHost,
  ClipboardPointer,
} from "../src/client/clipboard/anchor.js";
import { ClipboardAnchor } from "../src/client/clipboard/model.js";
import { dayFromIso } from "../src/layout/navigation.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const pointer = (x: number, y: number): ClipboardPointer => ({
  alt: false,
  key: "scope-A",
  shift: false,
  x,
  y,
});

const timeFixture = (date: string, zone: string) => {
  const root = document.createElement("section");
  const column = document.createElement("div");
  const header = document.createElement("header");
  let top = 0;
  root.className = "time-view";
  column.className = "day-column";
  column.dataset.day = String(dayFromIso(date));
  root.append(header, column);
  document.body.append(root);
  root.getBoundingClientRect = () => new DOMRect(0, 0, 100, 1440);
  column.getBoundingClientRect = () => new DOMRect(0, top, 100, 1440);

  const host: ClipboardGridHost = {
    key: "scope-A",
    mode: "time",
    root,
    scale: 60,
    zone,
  };

  return {
    column,
    header,
    host,
    scroll: (offset: number) => {
      top = -offset;
    },
  };
};

it.effect(
  "a chosen travel-zone clock becomes its actual instant, not a home-zone clock guess",
  () =>
    Effect.sync(() => {
      const fixture = timeFixture("2026-10-19", "Asia/Tokyo");

      const anchor = Option.getOrThrow(
        clipboardAnchorAt(fixture.host, pointer(50, 540), fixture.column)
      );

      expect(ClipboardAnchor.guards.Timed(anchor)).toBe(true);

      if (ClipboardAnchor.guards.Timed(anchor)) {
        expect(anchor.instant).toBe(
          DateTime.toEpochMillis(
            DateTime.makeUnsafe("2026-10-19T00:00:00.000Z")
          )
        );
        expect(anchor.date).toBe("2026-10-19");
      }
    })
);

it.effect(
  "same-key week scrolling re-hit-tests current geometry rather than reusing an old anchor",
  () =>
    Effect.sync(() => {
      const fixture = timeFixture("2026-10-19", "Asia/Tokyo");
      const point = pointer(50, 540);

      const before = Option.getOrThrow(
        clipboardAnchorAt(fixture.host, point, fixture.column)
      );

      fixture.scroll(60);

      const after = Option.getOrThrow(
        clipboardAnchorAt(fixture.host, point, fixture.column)
      );

      if (
        !ClipboardAnchor.guards.Timed(before) ||
        !ClipboardAnchor.guards.Timed(after)
      ) {
        throw new Error("Expected timed slot anchors");
      }

      expect(after.instant - before.instant).toBe(3_600_000);
    })
);

it.effect(
  "a sticky header, stale scope, outside point or non-existent DST clock cannot supply a timed paste anchor",
  () =>
    Effect.sync(() => {
      const fixture = timeFixture("2026-03-08", "America/Los_Angeles");
      expect(
        Option.isNone(
          clipboardAnchorAt(fixture.host, pointer(50, 150), fixture.column)
        )
      ).toBe(true);
      expect(
        Option.isNone(
          clipboardAnchorAt(fixture.host, pointer(50, 600), fixture.header)
        )
      ).toBe(true);
      expect(
        Option.isNone(
          clipboardAnchorAt(
            fixture.host,
            { ...pointer(50, 600), key: "prior-person-or-navigation" },
            fixture.column
          )
        )
      ).toBe(true);
      expect(
        Option.isNone(
          clipboardAnchorAt(fixture.host, pointer(100, 600), fixture.column)
        )
      ).toBe(true);
      expect(
        Option.isNone(
          clipboardAnchorAt(fixture.host, pointer(50, 1440), fixture.column)
        )
      ).toBe(true);
    })
);

it.effect(
  "month uses both axes, skips parked and unavailable cells, and re-hit-tests rolling weeks under an unchanged host key",
  () =>
    Effect.sync(() => {
      const root = document.createElement("section");
      root.className = "month-view";
      const first = document.createElement("div");
      const next = document.createElement("div");
      const unavailable = document.createElement("div");
      const parked = document.createElement("div");
      const parkedCell = document.createElement("div");

      for (const cell of [first, next, unavailable, parkedCell]) {
        cell.className = "month-cell";
      }

      first.dataset.day = String(dayFromIso("2026-10-19"));
      next.dataset.day = String(dayFromIso("2026-10-26"));
      parkedCell.dataset.day = String(dayFromIso("2026-10-12"));
      parked.dataset.monthParked = "true";
      parked.append(parkedCell);
      root.append(first, next, unavailable, parked);
      document.body.append(root);
      let scroll = 0;
      root.getBoundingClientRect = () => new DOMRect(0, 0, 100, 300);
      first.getBoundingClientRect = () => new DOMRect(0, -scroll, 100, 100);
      next.getBoundingClientRect = () => new DOMRect(0, 100 - scroll, 100, 100);
      unavailable.getBoundingClientRect = () =>
        new DOMRect(0, 200 - scroll, 100, 100);
      parkedCell.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);

      const host: ClipboardGridHost = {
        key: "scope-A",
        mode: "month",
        root,
        scale: 60,
        zone: "America/Los_Angeles",
      };

      const point = pointer(50, 50);
      expect(Option.getOrThrow(clipboardAnchorAt(host, point, first))).toEqual(
        ClipboardAnchor.cases.AllDay.make({ date: "2026-10-19" })
      );
      expect(
        Option.getOrThrow(clipboardAnchorAt(host, pointer(50, 150), next))
      ).toEqual(ClipboardAnchor.cases.AllDay.make({ date: "2026-10-26" }));
      expect(
        Option.isNone(clipboardAnchorAt(host, pointer(50, 150), first))
      ).toBe(true);
      expect(Option.isNone(clipboardAnchorAt(host, point, parkedCell))).toBe(
        true
      );
      expect(
        Option.isNone(clipboardAnchorAt(host, pointer(50, 250), unavailable))
      ).toBe(true);
      scroll = 100;
      expect(Option.getOrThrow(clipboardAnchorAt(host, point, next))).toEqual(
        ClipboardAnchor.cases.AllDay.make({ date: "2026-10-26" })
      );
    })
);

it.effect(
  "scoped pointer tracking removes the same handlers on close and ignores untrusted synthetic movement",
  () =>
    Effect.gen(function* pointerLifecycle() {
      const fixture = timeFixture("2026-10-19", "America/Los_Angeles");
      const added = vi.spyOn(document, "addEventListener");
      const removed = vi.spyOn(document, "removeEventListener");
      yield* Effect.scoped(
        Effect.gen(function* ownedTracker() {
          const read = yield* trackClipboardPointer(
            document,
            () => fixture.host
          );

          document.dispatchEvent(
            new MouseEvent("pointermove", { clientX: 50, clientY: 600 })
          );
          expect(read()).toBeUndefined();
        })
      );

      for (const name of ["pointermove", "pointerdown", "pointerout"]) {
        const registration = added.mock.calls.find(([type]) => type === name);
        expect(registration).toBeDefined();
        expect(removed).toHaveBeenCalledWith(name, registration?.[1], true);
      }
    })
);

it.effect(
  "an all-day chip uses the live day cell underneath it, not the timed column behind the sticky row",
  () =>
    Effect.sync(() => {
      const fixture = timeFixture("2026-10-19", "Pacific/Auckland");
      const row = document.createElement("div");
      const cell = document.createElement("div");
      const chip = document.createElement("button");
      row.className = "all-day";
      cell.className = "all-day-cell";
      cell.dataset.day = String(dayFromIso("2026-10-20"));
      cell.getBoundingClientRect = () => new DOMRect(0, 0, 100, 40);
      row.append(cell, chip);
      fixture.host.root.append(row);
      expect(
        Option.getOrThrow(
          clipboardAnchorAt(fixture.host, pointer(50, 20), chip)
        )
      ).toEqual(ClipboardAnchor.cases.AllDay.make({ date: "2026-10-20" }));
    })
);
