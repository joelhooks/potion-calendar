import { inflateSync } from "node:zlib";

import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Schema } from "effect";

import {
  calendarDotPng,
  trayIconPng,
  trayIconState,
} from "../src/tray-icon.js";
import type { TrayIconState } from "../src/tray-icon.js";
import { trayEvent, trayView } from "./tray-current-fixture.js";

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

const mark = Schema.Literals([
  "date-only",
  "accepted",
  "tentative",
  "unanswered",
]);

const dayNumber = Schema.Int.check(
  Schema.isBetween({ maximum: 31, minimum: 1 })
);

const decoded = (png: Buffer) => {
  const width = png.readUInt32BE(16);
  const rows = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));

  const pixel = (x: number, y: number) => [
    ...rows.subarray(
      y * (width * 4 + 1) + 1 + x * 4,
      y * (width * 4 + 1) + 5 + x * 4
    ),
  ];

  return { pixel, width };
};

it.effect.prop(
  "every calendar day and RSVP mark produces black-alpha artwork at both native scales",
  {
    day: Arbitrary.schema(dayNumber),
    status: Arbitrary.schema(mark),
  },
  ({ day, status }) =>
    Effect.sync(() => {
      const model: TrayIconState = { day, mark: status };
      const one = decoded(trayIconPng(model, 1));
      const two = decoded(trayIconPng(model, 2));
      expect(one.width).toBe(16);
      expect(two.width).toBe(32);

      for (let y = 0; y < 16; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          const rgba = one.pixel(x, y);
          expect(rgba.slice(0, 3)).toEqual([0, 0, 0]);
          expect([0, 255]).toContain(rgba[3]);

          for (const dx of [0, 1]) {
            for (const dy of [0, 1]) {
              expect(two.pixel(x * 2 + dx, y * 2 + dy)).toEqual(rgba);
            }
          }
        }
      }

      expect(one.pixel(0, 0)).toEqual([0, 0, 0, 0]);
    })
);

it.effect.prop(
  "date changes alter only the reserved digit region and RSVP states remain distinct",
  {
    day: Arbitrary.schema(dayNumber),
    status: Arbitrary.schema(mark),
  },
  ({ day, status }) =>
    Effect.sync(() => {
      const next = (day % 31) + 1;
      const image = trayIconPng({ day, mark: status }, 1);
      const changed = trayIconPng({ day: next, mark: status }, 1);
      expect(image).not.toEqual(changed);
      const before = decoded(image);
      const after = decoded(changed);

      for (let y = 0; y < 16; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          if (x < 3 || x > 9 || y < 8 || y > 12) {
            expect(before.pixel(x, y)).toEqual(after.pixel(x, y));
          }
        }
      }

      const images = ["date-only", "accepted", "tentative", "unanswered"].map(
        (value) =>
          trayIconPng(
            { day, mark: Schema.decodeUnknownSync(mark)(value) },
            1
          ).toString("base64")
      );

      expect(new Set(images).size).toBe(4);
    })
);

it.effect(
  "two-digit days retain separate full-width 3x5 glyphs at one-times size",
  () =>
    Effect.sync(() => {
      const image = decoded(trayIconPng({ day: 12, mark: "unanswered" }, 1));
      expect([3, 4, 5, 6, 7, 8, 9].map((x) => image.pixel(x, 8)[3])).toEqual([
        0, 255, 0, 0, 255, 255, 255,
      ]);
      expect([3, 4, 5, 6, 7, 8, 9].map((x) => image.pixel(x, 12)[3])).toEqual([
        255, 255, 255, 0, 255, 255, 255,
      ]);
      expect([8, 9, 10, 11, 12].map((y) => image.pixel(10, y)[3])).toEqual([
        0, 0, 0, 0, 0,
      ]);
    })
);

it.effect.prop(
  "actual self response owns imagery despite display fallback, busy state and preview settings",
  {
    enabled: Arbitrary.schema(Schema.Boolean),
    response: Arbitrary.schema(
      Schema.NullOr(
        Schema.Literals(["accepted", "tentative", "needsAction", "declined"])
      )
    ),
    time: Arbitrary.schema(Schema.Boolean),
    title: Arbitrary.schema(Schema.Boolean),
  },
  ({ response, enabled, title, time }) =>
    Effect.sync(() => {
      const event: AgendaEventValue = {
        ...trayEvent("self"),
        responseStatus: "accepted",
        rsvp: { enabled, response },
      };

      const expected = new Map<typeof response, TrayIconState["mark"]>([
        ["accepted", "accepted"],
        ["tentative", "tentative"],
        ["needsAction", "unanswered"],
        [null, "unanswered"],
        ["declined", "date-only"],
      ]);

      const actual = trayIconState({
        ...trayView([event]),
        preferences: {
          ...trayView([]).preferences,
          showTime: time,
          showTitle: title,
        },
      });

      expect(actual.mark).toBe(expected.get(response));
    })
);

it.effect(
  "declined display events are excluded and missing self metadata never claims acceptance",
  () =>
    Effect.sync(() => {
      const { rsvp, ...without } = trayEvent("missing-self");
      expect(
        trayIconState(trayView([{ ...without, responseStatus: "accepted" }]))
          .mark
      ).toBe("date-only");
      expect(trayIconState(trayView([{ ...without, rsvp }])).mark).toBe(
        "unanswered"
      );
      expect(
        trayIconState(
          trayView([{ ...trayEvent("declined"), responseStatus: "declined" }])
        ).mark
      ).toBe("date-only");
      expect(
        trayIconState(
          trayView([
            { ...trayEvent("declined"), responseStatus: "declined", start: 0 },
            trayEvent("next"),
          ])
        ).mark
      ).toBe("unanswered");
    })
);

it.effect.prop(
  "image date follows the sampled local calendar day rather than an invocation counter",
  {
    day: Arbitrary.schema(dayNumber),
    month: Arbitrary.schema(Schema.Literals([1, 3, 5, 7, 8, 10, 12])),
  },
  ({ day, month }) =>
    Effect.sync(() => {
      const now = DateTime.toEpochMillis(
        DateTime.makeZonedUnsafe(
          { day, hour: 12, month, year: 2028 },
          { adjustForTimeZone: true, timeZone: DateTime.zoneMakeLocal() }
        )
      );

      expect(trayIconState({ ...trayView([]), now })).toEqual({
        day,
        mark: "date-only",
      });
    })
);
