import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  IcsSaveRequest,
  IcsSuggestedName,
  desktopIcsFilename,
  desktopWire,
  icsSaveByteLimit,
  icsSaveNameLimit,
  icsSaveParseOptions,
  icsSaveWireLimit,
} from "../src/desktop-bridge.js";

const encoder = new TextEncoder();

const header = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-PADDING:";

const footer = "\r\nEND:VCALENDAR\r\n";

const calendar = (size: number): Uint8Array =>
  encoder.encode(
    `${header}${"x".repeat(size - header.length - footer.length)}${footer}`
  );

it.prop(
  "desktop suggestions remain bounded Unicode basenames without changing the browser filename",
  {
    characters: Schema.Array(
      Schema.Literals(["a", "9", "é", "日", "𐐀", "-"])
    ).check(Schema.isMaxLength(300)),
  },
  ({ characters }) => {
    const source = `a${characters.join("")}.ics`;
    const name = desktopIcsFilename(source);
    expect(Schema.is(IcsSuggestedName)(name)).toBe(true);
    expect(encoder.encode(name).byteLength).toBeLessThanOrEqual(
      icsSaveNameLimit
    );
    expect(source.startsWith(name.slice(0, -4))).toBe(true);
    expect(
      new TextDecoder("utf-8", { fatal: true }).decode(encoder.encode(name))
    ).toBe(name);
    expect(desktopIcsFilename(name)).toBe(name);
  }
);

it.effect(
  "rejects path and device suggestions rather than granting a renderer path",
  () =>
    Effect.sync(() => {
      const decode = Schema.decodeOption(IcsSuggestedName);

      for (const name of [
        "../events.ics",
        "/private/events.ics",
        "folder/events.ics",
        "folder\\events.ics",
        "C:events.ics",
        "C:\\events.ics",
        "..ics",
        ".ics",
        "con.ics",
        "PRN.ics",
        "AUX.ics",
        "NUL.ics",
        "COM1.ics",
        "LPT9.ics",
        "COM¹.ics",
        "event\u0000.ics",
        "event\n.ics",
        "event.txt",
      ]) {
        expect(Option.isNone(decode(name)), name).toBe(true);
        expect(desktopIcsFilename(name)).toBe("events.ics");
      }

      expect(Option.isNone(decode(`${"日".repeat(42)}.ics`))).toBe(true);
      expect(Option.isSome(decode(`${"a".repeat(124)}.ics`))).toBe(true);
      expect(Option.isNone(decode(`${"a".repeat(125)}.ics`))).toBe(true);
      expect(desktopIcsFilename(`${"日".repeat(42)}.ics`)).toBe(
        `${"日".repeat(41)}.ics`
      );

      for (const name of [
        "events.ics",
        "résumé.ics",
        "日程.ics",
        "𐐀-plan.ics",
      ]) {
        expect(Option.isSome(decode(name)), name).toBe(true);
        expect(desktopIcsFilename(name)).toBe(name);
      }
    })
);

it.effect(
  "round-trips exact calendar bytes at the decoded cap and rejects one byte over",
  () =>
    Effect.gen(function* byteBoundary() {
      const bytes = calendar(icsSaveByteLimit);
      const request = { bytes, suggestedName: "events.ics" };

      const message = yield* Schema.encodeEffect(
        desktopWire.saveIcs,
        icsSaveParseOptions
      )(request);

      const received = yield* Schema.decodeEffect(
        desktopWire.saveIcs,
        icsSaveParseOptions
      )(message);

      expect(received.bytes.byteLength).toBe(icsSaveByteLimit);
      expect(new TextDecoder().decode(received.bytes)).toBe(
        new TextDecoder().decode(bytes)
      );
      expect(received.suggestedName).toBe(request.suggestedName);

      const refused = yield* Schema.decodeEffect(
        IcsSaveRequest,
        icsSaveParseOptions
      )({ ...request, bytes: calendar(icsSaveByteLimit + 1) }).pipe(
        Effect.option
      );

      expect(Option.isNone(refused)).toBe(true);
    })
);

it.effect(
  "bounds wire bytes before parsing and rejects one byte over, including Unicode padding",
  () =>
    Effect.gen(function* wireBoundary() {
      const message = yield* Schema.encodeEffect(
        desktopWire.saveIcs,
        icsSaveParseOptions
      )({ bytes: calendar(256), suggestedName: "日程.ics" });

      const padding = " ".repeat(
        icsSaveWireLimit - encoder.encode(message).byteLength
      );

      const exact = yield* Schema.decodeEffect(
        desktopWire.saveIcs,
        icsSaveParseOptions
      )(message + padding);

      expect(exact.bytes.byteLength).toBe(256);

      const refused = yield* Schema.decodeEffect(
        desktopWire.saveIcs,
        icsSaveParseOptions
      )(`${message + padding} `).pipe(Effect.option);

      expect(Option.isNone(refused)).toBe(true);
    })
);

it.effect(
  "rejects malformed bytes, envelopes, extra fields and invented file types",
  () =>
    Effect.gen(function* invalidRequests() {
      const bytes = calendar(256);

      for (const request of [
        { bytes, path: "/private/events.ics", suggestedName: "events.ics" },
        { bytes, mime: "text/plain", suggestedName: "events.ics" },
        { bytes, fileType: "script", suggestedName: "events.ics" },
        { bytes: new Uint8Array([0xc3, 0x28]), suggestedName: "events.ics" },
        {
          bytes: new Uint8Array([
            ...encoder.encode(header),
            0xc3,
            0x28,
            ...encoder.encode(footer),
          ]),
          suggestedName: "events.ics",
        },
        { bytes: encoder.encode("plain text"), suggestedName: "events.ics" },
        {
          bytes: encoder.encode(`${header}\u0000${footer}`),
          suggestedName: "events.ics",
        },
      ]) {
        const decoded = yield* Schema.decodeEffect(
          IcsSaveRequest,
          icsSaveParseOptions
        )(request).pipe(Effect.option);

        expect(Option.isNone(decoded)).toBe(true);
      }

      for (const message of [
        "{",
        "null",
        "[]",
        '{"bytes":"%%%","suggestedName":"events.ics"}',
        '{"bytes":[],"suggestedName":"events.ics"}',
      ]) {
        const decoded = yield* Schema.decodeEffect(
          desktopWire.saveIcs,
          icsSaveParseOptions
        )(message).pipe(Effect.option);

        expect(Option.isNone(decoded)).toBe(true);
      }
    })
);
