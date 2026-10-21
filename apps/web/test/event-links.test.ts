import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  eventTextLinks,
  mapsLocation,
  ordinaryLink,
} from "../src/layout/event-links.js";

it.effect.prop(
  "linkification preserves every character and only emits the three approved protocols",
  { text: Schema.String },
  ({ text }) =>
    Effect.sync(() => {
      const parts = eventTextLinks(text);
      expect(parts.map((part) => part.text).join("")).toBe(text);

      for (const part of parts) {
        if (part.href !== undefined) {
          expect(["http:", "https:", "mailto:"]).toContain(
            new URL(part.href).protocol
          );
          expect(new URL(part.href).username).toBe("");
          expect(new URL(part.href).password).toBe("");
        }
      }
    })
);

it.effect.prop(
  "unsafe schemes, credentials and header injections stay plain text",
  {
    scheme: Schema.Literals([
      "javascript",
      "data",
      "file",
      "ftp",
      "tel",
      "vbscript",
    ]),
    tail: Schema.NonEmptyString,
  },
  ({ scheme, tail }) =>
    Effect.sync(() => {
      const value = `${scheme}:${encodeURIComponent(tail.replaceAll(/[\uD800-\uDFFF]/gu, "\uFFFD"))}`;
      expect(ordinaryLink(value)).toBeUndefined();
      expect(eventTextLinks(value)).toEqual([{ text: value }]);
      expect(
        ordinaryLink("https://user:secret@example.test/path")
      ).toBeUndefined();
      expect(
        ordinaryLink("mailto:owner@example.test?body=hello%0D%0AInjected")
      ).toBeUndefined();
    })
);

it.effect(
  "ordinary URLs open, conference URLs remain on Join and a plain address maps without rewriting a URL",
  () =>
    Effect.sync(() => {
      const parts = eventTextLinks(
        "Read https://example.test/notes, email mailto:owner@example.test or http://example.test/plain. Join https://meet.google.com/abc-defg-hij"
      );

      expect(
        parts.flatMap((part) => (part.href === undefined ? [] : [part.href]))
      ).toEqual([
        "https://example.test/notes",
        "mailto:owner@example.test",
        "http://example.test/plain",
      ]);
      expect(mapsLocation("123 Main Street, San Francisco")).toBe(
        "https://www.google.com/maps/search/?api=1&query=123%20Main%20Street%2C%20San%20Francisco"
      );
      // oxlint-disable-next-line eslint/no-script-url -- The negative case proves executable schemes never become map links.
      expect(mapsLocation("javascript:alert(1)")).toBeUndefined();
      expect(mapsLocation("https://example.test/location")).toBeUndefined();
    })
);
