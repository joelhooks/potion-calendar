import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Schema } from "effect";

import { captureClipboardItem } from "../src/client/clipboard/capture.js";
import {
  clipboardMarker,
  matchesClipboardEnvelope,
} from "../src/client/clipboard/identity.js";
import {
  ClipboardAnchor,
  ClipboardCaptureResult,
  ClipboardEnvelope,
  ClipboardItem,
  ClipboardRange,
} from "../src/client/clipboard/model.js";
import { placeClipboardItem } from "../src/client/clipboard/placement.js";
import {
  clipboardSendUpdates,
  composeClipboardCreationFields,
  composeClipboardDraft,
  prepareClipboardTemplate,
} from "../src/client/clipboard/template.js";
import { createDraft } from "../src/layout/editor-draft.js";
import { draftEventFields } from "../src/layout/editor-fields.js";
import { editorLocalTime } from "../src/layout/editor-time.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { clipboardItem, clipboardSource } from "./clipboard-fixture.js";

const integer = (minimum: number, maximum: number) =>
  Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(minimum),
    Schema.isLessThanOrEqualTo(maximum)
  );

const wall = (instant: number, zone: string) => {
  const values = new Map(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone: zone,
      year: "numeric",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );

  return {
    date: `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
    time: `${values.get("hour")}:${values.get("minute")}`,
  };
};

it.effect.prop(
  "paste keeps elapsed duration at the chosen travel-grid instant but writes the home zone",
  {
    active: Schema.Literals([
      "Asia/Tokyo",
      "Europe/London",
      "America/New_York",
    ]),
    home: Schema.Literals([
      "America/Los_Angeles",
      "Australia/Sydney",
      "Europe/London",
      "UTC",
    ]),
    minutes: integer(1, 240),
    month: Schema.Literals([3, 4, 10, 11]),
    year: integer(2025, 2040),
  },
  ({ active, home, minutes, month, year }) =>
    Effect.gen(function* elapsedPaste() {
      const date = `${year}-${String(month).padStart(2, "0")}-15`;

      const chosen = DateTime.toEpochMillis(
        Option.getOrThrow(editorLocalTime(date, "12:00", active))
      );

      const original = DateTime.toEpochMillis(
        DateTime.makeUnsafe("2026-10-19T00:00:00.000Z")
      );

      const item = clipboardItem(
        CalendarEvent.make({
          ...clipboardSource,
          end: {
            dateTime: DateTime.formatIso(
              DateTime.makeUnsafe(original + minutes * 60_000)
            ),
            timeZone: "Asia/Tokyo",
          },
          start: {
            dateTime: DateTime.formatIso(DateTime.makeUnsafe(original)),
            timeZone: "Asia/Tokyo",
          },
        })
      );

      const placed = yield* placeClipboardItem(
        item,
        ClipboardAnchor.cases.Timed.make({ date, instant: chosen }),
        home
      );

      const start = wall(chosen, home);
      const end = wall(chosen + minutes * 60_000, home);
      expect(placed).toMatchObject({
        allDay: false,
        endDate: end.date,
        endTime: end.time,
        startDate: start.date,
        startTime: start.time,
        timeZone: home,
      });

      const draft = yield* createDraft({
        ...placed,
        ref: { accountId: "personal", calendarId: "destination" },
      });

      const fields = yield* draftEventFields(draft);
      expect(fields.start).toEqual({
        dateTime: DateTime.formatIso(DateTime.makeUnsafe(chosen)),
        timeZone: home,
      });
      expect(fields.end).toEqual({
        dateTime: DateTime.formatIso(
          DateTime.makeUnsafe(chosen + minutes * 60_000)
        ),
        timeZone: home,
      });
    })
);

it.effect.prop(
  "date-only paste preserves calendar-day span and the chosen grid date rather than a duration in hours",
  {
    days: integer(1, 31),
    month: Schema.Literals([3, 4, 10, 11]),
    year: integer(2025, 2040),
  },
  ({ days, year, month }) =>
    Effect.gen(function* dateOnlyPaste() {
      const from = DateTime.makeUnsafe(
        `${year}-${String(month).padStart(2, "0")}-01`
      );

      const item = clipboardItem(
        CalendarEvent.make({
          ...clipboardSource,
          end: {
            date: DateTime.formatIsoDateUtc(DateTime.add(from, { days })),
          },
          start: { date: DateTime.formatIsoDateUtc(from) },
        })
      );

      const placed = yield* placeClipboardItem(
        item,
        ClipboardAnchor.cases.Timed.make({
          date: "2026-10-19",
          instant: DateTime.toEpochMillis(
            DateTime.makeUnsafe("2026-10-18T15:00:00.000Z")
          ),
        }),
        "America/Los_Angeles"
      );

      expect(placed.allDay).toBe(true);
      expect(placed.startDate).toBe("2026-10-19");
      expect(
        dayFromIso(placed.endDate) - dayFromIso(placed.startDate) + 1
      ).toBe(days);

      const fields = yield* draftEventFields(
        yield* createDraft({
          ...placed,
          ref: { accountId: "personal", calendarId: "destination" },
        })
      );

      expect(fields.start).toEqual({ date: placed.startDate });
      expect(fields.end).toEqual({
        date: DateTime.formatIsoDateUtc(
          DateTime.add(DateTime.makeUnsafe(placed.startDate), { days })
        ),
      });
    })
);

it.effect.prop(
  "privacy, free/busy and explicit false guest permissions survive template composition",
  {
    invite: Schema.Boolean,
    modify: Schema.Boolean,
    see: Schema.Boolean,
    transparency: Schema.Literals(["opaque", "transparent"]),
    visibility: Schema.Literals([
      "default",
      "public",
      "private",
      "confidential",
    ]),
  },
  ({ invite, modify, see, transparency, visibility }) =>
    Effect.gen(function* copiedAttributes() {
      const result = captureClipboardItem(
        CalendarEvent.make({
          ...clipboardSource,
          guestsCanInviteOthers: invite,
          guestsCanModify: modify,
          guestsCanSeeOtherGuests: see,
          transparency,
          visibility,
        }),
        ["owner@example.test"]
      );

      expect(ClipboardCaptureResult.guards.Captured(result)).toBe(true);

      const captured = yield* Effect.fromOption(
        ClipboardCaptureResult.guards.Captured(result)
          ? Option.some(result.item)
          : Option.none()
      );

      const template = yield* prepareClipboardTemplate(
        captured,
        "paste-intent",
        "exclude"
      );

      const fields = composeClipboardCreationFields(
        {
          location: "Draft location",
          start: {
            dateTime: "2026-10-19T00:00:00.000Z",
            timeZone: "Asia/Tokyo",
          },
          title: "Draft title",
        },
        template
      );

      expect(fields).toMatchObject({
        guestsCanInviteOthers: invite,
        guestsCanModify: modify,
        guestsCanSeeOtherGuests: see,
        location: "Draft location",
        title: "Draft title",
        transparency,
        visibility,
      });
      expect(fields.start).toEqual({
        dateTime: "2026-10-19T00:00:00.000Z",
        timeZone: "Asia/Tokyo",
      });
    })
);

it.effect(
  "the owned capture excludes provider conference payload, identity tokens and participant response/organizer flags",
  () =>
    Effect.sync(() => {
      const item = clipboardItem();
      const encoded = JSON.stringify(item);
      expect(encoded).not.toContain("native-private");
      expect(encoded).not.toContain("provider-only-ical");
      expect(encoded).not.toContain("provider-only-etag");
      expect(item.nativeConference).toBe(true);
      expect(item.recurring).toBe(true);
      expect(item.guests).toEqual([
        {
          displayName: "Alex",
          email: "alex@example.test",
          optional: true,
          resource: false,
        },
      ]);
      expect(item.source).toEqual({
        accountId: "work",
        calendarId: "primary",
        eventId: "copied-event",
      });
    })
);

it.effect(
  "excluding guests means no invitation; explicit inclusion resets response state without changing temporal or ordinary draft state",
  () =>
    Effect.gen(function* explicitGuests() {
      const item = clipboardItem();

      const range = yield* placeClipboardItem(
        item,
        ClipboardAnchor.cases.Timed.make({
          date: "2026-10-19",
          instant: DateTime.toEpochMillis(
            DateTime.makeUnsafe("2026-10-19T17:00:00.000Z")
          ),
        }),
        "America/Los_Angeles"
      );

      const base = yield* createDraft({
        ...range,
        ref: { accountId: "personal", calendarId: "destination" },
      });

      for (const choice of ["exclude", "includeAndEmail"] as const) {
        const template = yield* prepareClipboardTemplate(
          item,
          "paste-intent",
          choice
        );

        const draft = composeClipboardDraft(base, template);
        expect(draft).toMatchObject({
          accountId: "personal",
          calendarId: "destination",
          endDate: range.endDate,
          endTime: range.endTime,
          participantEmail: "",
          reminderInput: "",
          repeat: base.repeat,
          startDate: range.startDate,
          startTime: range.startTime,
          timeZone: range.timeZone,
          title: clipboardSource.title,
        });
        expect(draft.attendees).toEqual(
          choice === "exclude"
            ? []
            : [
                {
                  displayName: "Alex",
                  email: "alex@example.test",
                  optional: true,
                  resource: false,
                  responseStatus: "needsAction",
                },
              ]
        );
        expect(clipboardSendUpdates(template)).toBe(
          choice === "exclude" ? "none" : "all"
        );
      }

      const noGuests = yield* prepareClipboardTemplate(
        { ...item, guests: [] },
        "paste-intent",
        "includeAndEmail"
      );

      expect(clipboardSendUpdates(noGuests)).toBe("none");
    })
);

it.effect(
  "an incomplete source guest list may be excluded but cannot be silently included as complete",
  () =>
    Effect.gen(function* incompleteGuests() {
      const item = { ...clipboardItem(), guestsComplete: false };
      expect(
        (yield* prepareClipboardTemplate(item, "paste-intent", "exclude"))
          .guests
      ).toEqual([]);
      expect(
        (yield* Effect.flip(
          prepareClipboardTemplate(item, "paste-intent", "includeAndEmail")
        )).reason
      ).toBe("incompleteGuests");
    })
);

it.effect(
  "the owned clipboard marker carries neither event data nor person data and requires both marker and person identity",
  () =>
    Effect.sync(() => {
      const envelope = ClipboardEnvelope.make({
        id: "opaque-copy-id",
        items: [clipboardItem()],
        personId: "person-A",
        version: 1,
      });

      const marker = clipboardMarker(envelope.id);
      expect(marker).not.toContain(clipboardSource.title ?? "Product review");
      expect(marker).not.toContain(envelope.personId);
      expect(matchesClipboardEnvelope(envelope, "person-A", marker)).toBe(true);
      expect(matchesClipboardEnvelope(envelope, "person-B", marker)).toBe(
        false
      );
      expect(
        matchesClipboardEnvelope(envelope, "person-A", "arbitrary user text")
      ).toBe(false);
    })
);

it.effect.each([
  "2026-11-01T08:30:00.000Z",
  "2026-11-01T09:30:00.000Z",
  "2026-10-19T17:00:30.000Z",
])(
  "ambiguous or sub-minute endpoints refuse rather than lose the chosen instant: %s",
  (instant) =>
    Effect.gen(function* unsafePaste() {
      const item = ClipboardItem.make({
        ...clipboardItem(),
        range: ClipboardRange.cases.Timed.make({ end: 60 * 60_000, start: 0 }),
      });

      const error = yield* Effect.flip(
        placeClipboardItem(
          item,
          ClipboardAnchor.cases.Timed.make({
            date: instant.slice(0, 10),
            instant: DateTime.toEpochMillis(DateTime.makeUnsafe(instant)),
          }),
          "America/Los_Angeles"
        )
      );

      expect(error.reason).toBe("ambiguousTime");
    })
);

it.effect(
  "a timed copy cannot invent a time when only an all-day date was chosen",
  () =>
    Effect.gen(function* missingPasteTime() {
      const error = yield* Effect.flip(
        placeClipboardItem(
          clipboardItem(),
          ClipboardAnchor.cases.AllDay.make({ date: "2026-10-19" }),
          "America/Los_Angeles"
        )
      );

      expect(error.reason).toBe("missingTime");
    })
);

it.effect.each([
  "focusTime",
  "outOfOffice",
  "birthday",
  "workingLocation",
  "fromGmail",
] as const)(
  "unsupported provider event type %s refuses instead of becoming an ordinary event",
  (eventType) =>
    Effect.sync(() => {
      const result = captureClipboardItem(
        { ...clipboardSource, eventType },
        []
      );

      expect(ClipboardCaptureResult.guards.Refused(result)).toBe(true);
    })
);
