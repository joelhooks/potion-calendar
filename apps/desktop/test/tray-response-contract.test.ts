import { desktopWire } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

const key = { accountId: "work", calendarId: "primary", eventId: "instance" };

it.effect.each(["accepted", "declined", "tentative"] as const)(
  "the desktop action accepts a note-free %s response for the exact event key",
  (response) =>
    Effect.sync(() => {
      const wire = `{"_tag":"RespondToEvent","key":${JSON.stringify(key)},"response":${JSON.stringify(response)},"note":"Never forward this draft"}`;
      const decoded = Schema.decodeOption(desktopWire.action)(wire);

      expect(Option.isSome(decoded)).toBe(true);
      expect(Option.getOrUndefined(decoded)).toMatchObject({ key, response });
      expect(Option.getOrUndefined(decoded)).toHaveProperty(
        "_tag",
        "RespondToEvent"
      );
      expect(Option.getOrUndefined(decoded)).not.toHaveProperty("note");
    })
);

it.effect(
  "the desktop response boundary refuses malformed keys and non-choice responses",
  () =>
    Effect.sync(() => {
      for (const wire of [
        '{"_tag":"RespondToEvent","key":{"accountId":"work","calendarId":"primary","eventId":"instance"},"response":"needsAction"}',
        '{"_tag":"RespondToEvent","key":{"accountId":"work","calendarId":"primary","eventId":"instance"},"response":"yes"}',
        '{"_tag":"RespondToEvent","key":{"accountId":"","calendarId":"primary","eventId":"instance"},"response":"accepted"}',
        '{"_tag":"RespondToEvent","key":{"eventId":"instance"},"response":"accepted"}',
      ]) {
        expect(
          Option.isNone(Schema.decodeOption(desktopWire.action)(wire))
        ).toBe(true);
      }
    })
);
