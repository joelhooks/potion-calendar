import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";

import { clipboardNativeHost } from "../src/client/clipboard/host.js";
import { NativeClipboardNotice } from "../src/client/clipboard/model.js";
import { observeNativeClipboard } from "../src/client/clipboard/native.js";
import {
  groupClipboardFixture,
  groupNativeEvent,
} from "./clipboard-group-fixture.js";

const nativeGroupHost = () => {
  const fixture = groupClipboardFixture();

  const host = clipboardNativeHost(
    fixture.model,
    {
      canReceive: () => true,
      copied: () => {},
      native: () => Effect.void,
      notices: Stream.empty,
      personId: fixture.personId,
      sessionId: "group-native",
    },
    fixture.anchor,
    document
  );

  if (host?.group === undefined) {
    throw new Error("Group native host unavailable");
  }

  return { ...host, group: host.group, selected: fixture.events[0] };
};

it.each(["copy", "cut"] as const)(
  "%s refuses missing or unsupported members rather than falling back to the primary; mixed sets never publish a marker or start deletion",
  (operation) => {
    for (const boundary of ["missing", "unsupported", "mixed"] as const) {
      const host = nativeGroupHost();

      const candidates = host.group.candidates.flatMap((candidate, index) => {
        if (index !== 1) {
          return [candidate];
        }

        if (boundary === "missing") {
          return [];
        }

        return [
          {
            ...candidate,
            event: CalendarEvent.make(
              boundary === "mixed"
                ? {
                    ...candidate.event,
                    end: { date: "2026-10-20" },
                    start: { date: "2026-10-19" },
                  }
                : { ...candidate.event, eventType: "outOfOffice" }
            ),
          },
        ];
      });

      const copied = groupNativeEvent("original clipboard text");

      const notice = Option.getOrThrow(
        observeNativeClipboard(
          { ...host, group: { ...host.group, candidates } },
          copied.event,
          operation,
          1,
          document,
          false
        )
      );

      expect(NativeClipboardNotice.guards.Refused(notice)).toBe(true);

      if (NativeClipboardNotice.guards.Refused(notice)) {
        expect(notice.failure.reason).toBe(
          boundary === "mixed" ? "mixedRanges" : "incompleteSelection"
        );
      }

      expect(copied.data.get("text/plain")).toBe("original clipboard text");
      expect(copied.event.defaultPrevented).toBe(true);
    }
  }
);

it("failed marker publication cannot publish group Cut, and foreign clipboard text remains native rather than becoming a group paste", () => {
  const host = nativeGroupHost();
  const broken = groupNativeEvent();

  const failed = Option.getOrThrow(
    observeNativeClipboard(
      host,
      {
        ...broken.event,
        clipboardData: {
          ...broken.event.clipboardData,
          setData: () => {
            throw new Error("System clipboard write failed");
          },
        },
      },
      "cut",
      1,
      document,
      false
    )
  );

  expect(NativeClipboardNotice.guards.Refused(failed)).toBe(true);
  const copied = groupNativeEvent();

  const notice = Option.getOrThrow(
    observeNativeClipboard(host, copied.event, "copy", 2, document, false)
  );

  if (!NativeClipboardNotice.guards.Copied(notice)) {
    throw new Error("Valid group copy refused");
  }

  expect(notice.envelope.items).toHaveLength(3);
  expect(notice.envelope.selectionKeys).toEqual(host.group.selection);
  const text = groupNativeEvent("ordinary unowned text");

  const invalidated = Option.getOrThrow(
    observeNativeClipboard(
      { ...host, copied: { id: notice.envelope.id, personId: host.personId } },
      text.event,
      "paste",
      3,
      document,
      false
    )
  );

  expect(NativeClipboardNotice.guards.Invalidated(invalidated)).toBe(true);
  expect(text.event.defaultPrevented).toBe(false);
  expect(text.data.get("text/plain")).toBe("ordinary unowned text");
});
