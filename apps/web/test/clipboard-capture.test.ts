import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { captureClipboardItem } from "../src/client/clipboard/capture.js";
import { ClipboardCaptureResult } from "../src/client/clipboard/model.js";
import {
  composeClipboardCreationFields,
  prepareClipboardTemplate,
} from "../src/client/clipboard/template.js";
import { clipboardItem, clipboardSource } from "./clipboard-fixture.js";

it.effect.each([
  CalendarEvent.make({ ...clipboardSource, end: undefined }),
  CalendarEvent.make({ ...clipboardSource, end: clipboardSource.start }),
  CalendarEvent.make({ ...clipboardSource, start: { date: "2026-10-19" } }),
  CalendarEvent.make({
    ...clipboardSource,
    end: { date: "2026-03-03" },
    start: { date: "2026-02-30" },
  }),
  CalendarEvent.make({ ...clipboardSource, status: "cancelled" }),
])(
  "an invalid or unsupported source refuses capture without an envelope",
  (source) =>
    Effect.sync(() => {
      const result = captureClipboardItem(source, []);
      expect(ClipboardCaptureResult.guards.Refused(result)).toBe(true);
    })
);

it.effect(
  "absent copied attributes cannot erase ordinary create-field defaults",
  () =>
    Effect.gen(function* ordinaryDefaults() {
      const source = CalendarEvent.make({
        accountId: "work",
        attachments: [],
        calendarId: "primary",
        end: clipboardSource.end,
        eventId: "plain",
        start: clipboardSource.start,
        status: "confirmed",
      });

      const template = yield* prepareClipboardTemplate(
        clipboardItem(source),
        "paste-intent",
        "exclude"
      );

      expect(
        composeClipboardCreationFields(
          {
            guestsCanModify: false,
            transparency: "transparent",
            visibility: "private",
          },
          template
        )
      ).toEqual({
        attachments: [],
        guestsCanModify: false,
        transparency: "transparent",
        visibility: "private",
      });
    })
);

it.effect(
  "linked identities and duplicate addresses never become extra guest invitations",
  () =>
    Effect.sync(() => {
      const source = CalendarEvent.make({
        ...clipboardSource,
        attendees: [
          { email: "alternate@example.test", organizer: true },
          { email: "alex@example.test", optional: true },
          { email: "ALEX@example.test", optional: false },
        ],
      });

      const result = captureClipboardItem(source, ["alternate@example.test"]);
      expect(ClipboardCaptureResult.guards.Captured(result)).toBe(true);

      if (ClipboardCaptureResult.guards.Captured(result)) {
        expect(result.item.guests).toEqual([
          {
            displayName: undefined,
            email: "alex@example.test",
            optional: true,
            resource: false,
          },
        ]);
      }
    })
);
