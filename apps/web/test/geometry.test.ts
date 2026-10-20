import { expect, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";

import { conferenceLink } from "../src/layout/conferencing.js";
import {
  hourHeight,
  initialScroll,
  nearFullDay,
  timeTop,
} from "../src/layout/geometry.js";

const instant = (iso: string): number =>
  DateTime.toEpochMillis(DateTime.makeUnsafe(iso));

it.effect("hour zoom, minimum, and initial scroll obey viewport geometry", () =>
  Effect.sync(() => {
    expect(hourHeight(0, 700)).toBe(48);
    expect(hourHeight(1, 700)).toBe(56);
    expect(hourHeight(-100, 200)).toBe(16);
    expect(hourHeight(-100, 1013)).toBe(40);
    expect(hourHeight(100, 700)).toBe(208);
    expect(timeTop(630, 48)).toBe(504);
    expect(initialScroll(630, 48, 600)).toBe(304);
    expect(initialScroll(0, 48, 600)).toBe(0);
    expect(initialScroll(1439, 48, 600)).toBe(552);
  })
);

it.effect(
  "nearly full local days use the DST-adjusted one-minute threshold",
  () =>
    Effect.sync(() => {
      expect(
        nearFullDay(
          instant("2026-03-08T00:00:00-08:00"),
          instant("2026-03-08T23:59:00-07:00"),
          "America/Los_Angeles"
        )
      ).toBe(true);
      expect(
        nearFullDay(
          instant("2026-11-01T00:00:00-07:00"),
          instant("2026-11-01T23:58:00-08:00"),
          "America/Los_Angeles"
        )
      ).toBe(false);
    })
);

it.effect(
  "join recognizes supported families and refuses unsafe or lookalike URLs",
  () =>
    Effect.sync(() => {
      expect(
        conferenceLink(undefined, "Join https://meet.google.com/abc-defg-hij.")
      ).toBe("https://meet.google.com/abc-defg-hij");
      expect(
        conferenceLink(undefined, undefined, "https://example.zoom.us/j/123")
      ).toBe("https://example.zoom.us/j/123");
      expect(
        conferenceLink(undefined, "https://zoom.us.attacker.test/j/123")
      ).toBeUndefined();
      // oxlint-disable-next-line eslint/no-script-url -- Exercise rejection of executable conference URLs.
      expect(conferenceLink("javascript:alert(1)")).toBeUndefined();
      expect(conferenceLink("https://custom.example.test/room")).toBe(
        "https://custom.example.test/room"
      );
    })
);
