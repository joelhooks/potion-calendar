import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { escapeIcsText, foldIcsLine } from "../src/ical-text.js";

const unicodeScalar = Schema.Union([
  Schema.Int.check(Schema.isBetween({ maximum: 0xd7_ff, minimum: 0 })),
  Schema.Int.check(Schema.isBetween({ maximum: 0x10_ff_ff, minimum: 0xe0_00 })),
]);

const readTextValue = (value: string): string => {
  const points: string[] = [];

  for (const point of value) {
    points.push(point);
  }

  const decoded: string[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];

    if (point === "\\") {
      const escaped = points[index + 1];
      expect(["\\", ";", ",", "n"]).toContain(escaped);
      decoded.push(escaped === "n" ? "\n" : (escaped ?? ""));
      index += 1;
    } else {
      expect([";", ",", "\r", "\n"]).not.toContain(point);
      decoded.push(point ?? "");
    }
  }

  return decoded.join("");
};

it.prop(
  "ICS TEXT escaping preserves generated values and escapes every reserved delimiter and line break",
  { points: Schema.Array(unicodeScalar) },
  ({ points }) => {
    const text = points.map((point) => String.fromCodePoint(point)).join("");
    const original = `${text}\\;,\r\n${text}\r${text}\n`;
    const escaped = escapeIcsText(original);

    expect(readTextValue(escaped)).toBe(original.replaceAll(/\r\n?/gu, "\n"));
  }
);

it.prop(
  "ICS folding unfolds exactly while each CRLF physical line stays within 75 UTF-8 octets and never splits a code point",
  { points: Schema.Array(unicodeScalar) },
  ({ points }) => {
    const text = points.map((point) => String.fromCodePoint(point)).join("");
    const logical = `SUMMARY:${escapeIcsText(text.repeat(8))}${"🙂".repeat(40)}`;
    const folded = foldIcsLine(logical);
    const physical = folded.split("\r\n");
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8", { fatal: true });

    expect(folded.replaceAll(/\r\n[ \t]/gu, "")).toBe(logical);
    expect(folded.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/u);
    expect(physical.length).toBeGreaterThan(1);

    for (const [index, line] of physical.entries()) {
      const bytes = encoder.encode(line);
      expect(bytes.byteLength).toBeLessThanOrEqual(75);
      expect(decoder.decode(bytes)).toBe(line);

      if (index > 0) {
        expect(line.startsWith(" ")).toBe(true);
      }
    }
  }
);
