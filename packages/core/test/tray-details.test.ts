import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  AgendaSnapshot,
  desktopWire,
  projectTrayDetails,
  TrayDetails,
  trayDisplayText,
} from "../src/desktop-bridge.js";
import { composeParticipantEmail } from "../src/participant-email.js";

it.effect(
  "the shared composer preserves exact recipient and subject bytes and refuses unsafe compositions",
  () =>
    Effect.sync(() => {
      expect(
        composeParticipantEmail("  Café & review? #1  ", [
          "guest+tag@example.test",
        ])
      ).toEqual({
        href: "mailto:guest%2Btag@example.test?subject=%20%20Caf%C3%A9%20%26%20review%3F%20%231%20%20",
        kind: "ready",
        recipients: ["guest+tag@example.test"],
      });

      for (const [title, recipients] of [
        ["x", []],
        ["x\nBcc:bad", ["guest@example.test"]],
        ["x", ["bad\r@example.test"]],
        ["\uD800", ["guest@example.test"]],
        ["x", ["\uDFFF"]],
        ["x", ["no-at-sign"]],
      ] as const) {
        expect(composeParticipantEmail(title, recipients).kind).toBe(
          "disabled"
        );
      }

      const prefix = "mailto:guest@example.test?subject=";

      const exact = composeParticipantEmail("x".repeat(2000 - prefix.length), [
        "guest@example.test",
      ]);

      expect(exact.kind).toBe("ready");
      expect(
        composeParticipantEmail("x".repeat(2001 - prefix.length), [
          "guest@example.test",
        ])
      ).toEqual({
        kind: "disabled",
        reason: "Too many guests to email from here.",
      });
    })
);

it.effect(
  "tray details strip control and bidi display text while omitting whole over-budget actions without shifting original indexes",
  () =>
    Effect.sync(() => {
      const result = projectTrayDetails(
        "Room\n42\u202E / east",
        [
          { title: "Unsafe", url: "http://files.example.test/x" },
          {
            title: "Large",
            url: `https://files.example.test/${"x".repeat(8192)}`,
          },
          {
            title: "Report\u2066\tPDF",
            url: "https://files.example.test/report",
          },
        ],
        composeParticipantEmail("Plan", ["guest@example.test"])
      );

      expect(result.location).toBe("Room 42 / east");
      expect(result.attachments).toEqual([
        {
          index: 2,
          title: "Report PDF",
          url: "https://files.example.test/report",
        },
      ]);
      expect(result.email).toEqual({
        href: "mailto:guest@example.test?subject=Plan",
        recipientCount: 1,
      });
      expect(Schema.is(TrayDetails)(result)).toBe(true);
      expect(
        new TextEncoder().encode(trayDisplayText("🍄".repeat(1000), 512))
          .byteLength
      ).toBe(512);
      expect(trayDisplayText("🍄".repeat(1000), 513)).not.toContain("\uFFFD");
    })
);

it.effect(
  "whole attachment URLs survive the exact byte boundary and encoded-budget overflow omits actions instead of invalidating the agenda",
  () =>
    Effect.sync(() => {
      const prefix = "https://files.example.test/";
      const exact = prefix + "x".repeat(8192 - prefix.length);
      const full = prefix + '"'.repeat(8192 - prefix.length);

      const near = projectTrayDetails(
        "Room",
        [
          { title: "Exact", url: exact },
          { title: "Over", url: `${exact}x` },
        ],
        { kind: "disabled" }
      );

      expect(near.attachments).toEqual([
        { index: 0, title: "Exact", url: exact },
      ]);

      const large = projectTrayDetails(
        "Room",
        Array.from({ length: 20 }, () => ({
          title: '"'.repeat(256),
          url: full,
        })),
        { kind: "disabled" }
      );

      expect(large.attachments.length).toBeGreaterThan(0);
      expect(large.attachments.length).toBeLessThan(20);
      expect(large.attachments.every((row) => row.url === full)).toBe(true);
      expect(
        new TextEncoder().encode(JSON.stringify(large)).byteLength
      ).toBeLessThanOrEqual(256 * 1024);
      expect(Schema.is(TrayDetails)(large)).toBe(true);
    })
);

it.effect(
  "the actual agenda JSON codec supports old payloads and bounds the optional v1 details without accepting unsupported metadata",
  () =>
    Effect.sync(() => {
      const event = {
        allDay: false,
        calendarColor: "#64748b",
        conferenceUrl: null,
        end: 20,
        hasLocation: true,
        hasParticipants: false,
        key: { accountId: "a", calendarId: "c", eventId: "e" },
        responseStatus: "accepted",
        start: 10,
        title: "Plan",
      };

      expect(
        Schema.decodeUnknownOption(AgendaSnapshot)({ events: [event] }).pipe(
          Option.isSome
        )
      ).toBe(true);
      const details = projectTrayDetails("Room", [], { kind: "disabled" });
      const input = { events: [{ ...event, trayDetails: details }] };
      expect(
        Schema.decodeOption(desktopWire.agenda)(JSON.stringify(input)).pipe(
          Option.getOrThrow
        )
      ).toEqual(input);

      for (const trayDetails of [
        { ...details, version: 2 },
        { ...details, location: "x".repeat(513) },
        { ...details, location: "Room\u202E" },
        {
          ...details,
          email: { href: "https://example.test", recipientCount: 1 },
        },
        {
          ...details,
          email: { href: "mailto:a@b?subject=x", recipientCount: 0 },
        },
        {
          ...details,
          attachments: [
            { index: 20, title: "x", url: "https://files.example.test/x" },
          ],
        },
        {
          ...details,
          attachments: [{ index: 0, title: "x", url: "file:///etc/passwd" }],
        },
      ]) {
        expect(
          Schema.decodeOption(desktopWire.agenda)(
            JSON.stringify({ events: [{ ...event, trayDetails }] })
          ).pipe(Option.isNone)
        ).toBe(true);
      }
    })
);
