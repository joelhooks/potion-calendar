import { inflateSync } from "node:zlib";

import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import { calendarDotPng } from "../src/tray-icon.js";

const channel = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 255, minimum: 0 }))
);

it.effect.prop(
  "calendar icon PNG scanlines preserve RGB channels and transparent corners",
  { blue: channel, green: channel, red: channel },
  ({ red, green, blue }) =>
    Effect.sync(() => {
      const color = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
      const image = calendarDotPng(color);
      expect(image.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      );
      expect(image.readUInt32BE(16)).toBe(16);
      expect(image.readUInt32BE(20)).toBe(16);
      const dataLength = image.readUInt32BE(33);
      expect(image.subarray(37, 41).toString("ascii")).toBe("IDAT");
      const rows = inflateSync(image.subarray(41, 41 + dataLength));
      const center = 8 * 65 + 1 + 8 * 4;
      expect([...rows.subarray(center, center + 4)]).toEqual([
        red,
        green,
        blue,
        255,
      ]);
      expect(rows[4]).toBe(0);
    })
);
