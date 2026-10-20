import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Schema } from "effect";

import { seriesChanges } from "../../../packages/calendar/src/recurrence.js";
import { changeEditor } from "../src/client/editing/change-editor.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { LoadedEditor } from "../src/client/editing/editor-session-model.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { createDraft, eventDraft } from "../src/layout/editor-draft.js";
import { draftChanges, draftEventFields } from "../src/layout/editor-fields.js";
import {
  changeEventZone,
  rebaseEditorRange,
} from "../src/layout/editor-zone.js";
import {
  editorCalendars,
  editorDraft,
  editorOriginal,
} from "./editor-fixture.js";
import { fixtureSelection } from "./fixture.js";

const sessionFor = (draft = editorDraft) =>
  LoadedEditor.make({
    baseline: editorDraft,
    calendars: editorCalendars,
    createId: Option.none(),
    draft,
    id: "event-zone-unit",
    kind: "edit",
    master: Option.none(),
    moveSupport: "available",
    navigation: fixtureSelection().calendar.navigation,
    operation: "save",
    original: Option.some(editorOriginal),
    selection: Option.none(),
  });

const TimedFields = Schema.Struct({
  end: Schema.Struct({ dateTime: Schema.String, timeZone: Schema.String }),
  start: Schema.Struct({ dateTime: Schema.String, timeZone: Schema.String }),
});

const localLabel = (instant: string, zone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: zone,
    year: "numeric",
  }).format(DateTime.toEpochMillis(DateTime.makeUnsafe(instant)));

const Year = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(2025),
  Schema.isLessThanOrEqualTo(2040)
);

const Zone = Schema.Literals(["America/Los_Angeles", "Australia/Sydney"]);

it.effect.prop(
  "weekly timed drafts keep 09:00 in their stored zone through both hemispheres' DST transitions, regardless of viewer",
  {
    viewer: Schema.Literals(["UTC", "Asia/Tokyo", "Europe/London"]),
    year: Year,
    zone: Zone,
  },
  ({ viewer, year, zone }) =>
    Effect.gen(function* weeklyWallClock() {
      for (const month of zone === "America/Los_Angeles" ? [3, 11] : [4, 10]) {
        for (let week = -1; week < 5; week += 1) {
          const date = DateTime.formatIsoDateUtc(
            DateTime.add(DateTime.makeUnsafe({ day: 1, month, year }), {
              weeks: week,
            })
          );

          const input = {
            ...editorDraft,
            endDate: date,
            endTime: "10:00",
            repeat: { ...editorDraft.repeat, preset: "weekly" },
            startDate: date,
            startTime: "09:00",
            timeZone: "UTC",
          } satisfies typeof editorDraft;

          const draft = yield* changeEventZone(input, zone);
          const fields = yield* draftEventFields(draft);

          const { start, end } =
            yield* Schema.decodeUnknownEffect(TimedFields)(fields);

          expect(start.timeZone).toBe(zone);
          expect(end.timeZone).toBe(zone);
          expect(localLabel(start.dateTime, zone)).toBe(`${date}, 09:00`);
          expect(localLabel(end.dateTime, zone)).toBe(`${date}, 10:00`);
          expect(fields.recurrence?.[0]).toContain("FREQ=WEEKLY");

          const loaded = yield* eventDraft(
            {
              ...editorOriginal,
              end,
              recurrence: fields.recurrence,
              start,
            },
            undefined,
            viewer
          );

          expect(loaded.timeZone).toBe(zone);
          expect(loaded.startDate).toBe(date);
          expect(loaded.startTime).toBe("09:00");
        }
      }
    })
);

it.effect.prop(
  "All anchors the requested named clock to the master's date instead of copying the selected occurrence's seasonal offset",
  { year: Year, zone: Zone },
  ({ year, zone }) =>
    Effect.gen(function* masterWallClock() {
      const month = zone === "America/Los_Angeles" ? 3 : 10;
      const first = `${year}-${String(month).padStart(2, "0")}-01`;
      const later = `${year}-${String(month).padStart(2, "0")}-29`;

      const master: CalendarEventValue = {
        ...editorOriginal,
        end: { dateTime: `${first}T10:00:00Z`, timeZone: "UTC" },
        recurrence: ["RRULE:FREQ=WEEKLY"],
        start: { dateTime: `${first}T09:00:00Z`, timeZone: "UTC" },
      };

      const selected: CalendarEventValue = {
        ...editorOriginal,
        end: { dateTime: `${later}T10:00:00Z`, timeZone: "UTC" },
        start: { dateTime: `${later}T09:00:00Z`, timeZone: "UTC" },
      };

      const baseline = yield* eventDraft(selected, master, "Asia/Tokyo");
      const draft = yield* changeEventZone(baseline, zone);

      const delta = draftChanges(
        draft,
        baseline,
        yield* draftEventFields(draft)
      );

      const changed = yield* seriesChanges(master, selected, delta.changes);

      const { start, end } =
        yield* Schema.decodeUnknownEffect(TimedFields)(changed);

      expect(start.timeZone).toBe(zone);
      expect(end.timeZone).toBe(zone);
      expect(localLabel(start.dateTime, zone)).toBe(`${first}, 09:00`);
      expect(localLabel(end.dateTime, zone)).toBe(`${first}, 10:00`);
    })
);

it.effect(
  "all-day gesture ranges stay calendar dates across travel zones",
  () =>
    Effect.gen(function* allDayRange() {
      const range = {
        allDay: true,
        endDate: "2026-10-20",
        endTime: "00:00",
        startDate: "2026-10-19",
        startTime: "00:00",
      };

      expect(
        yield* rebaseEditorRange(range, "Asia/Tokyo", "America/Los_Angeles")
      ).toEqual(range);
    })
);

it.effect("zone selection is a permission-checked wall-clock-only action", () =>
  Effect.gen(function* selection() {
    const session = sessionFor();

    const changed = yield* changeEditor({
      action: EditorAction.cases.TimeZoneSelected.make({ value: "Asia/Tokyo" }),
      custom: Option.none(),
      session,
    });

    expect(changed.draft).toEqual({ ...session.draft, timeZone: "Asia/Tokyo" });
    expect(changed.baseline).toEqual(session.baseline);

    const allDay = yield* changeEventZone(
      { ...editorDraft, allDay: true },
      "Asia/Tokyo"
    ).pipe(Effect.flip);

    expect(allDay.message).toContain("All-day");

    const forbidden = yield* changeEditor({
      action: EditorAction.cases.TimeZoneSelected.make({ value: "Asia/Tokyo" }),
      custom: Option.none(),
      session: {
        ...session,
        calendars: editorCalendars.map((calendar) => ({
          ...calendar,
          accessRole: "reader",
        })),
      },
    }).pipe(Effect.flip);

    expect(forbidden.message).toContain("permissions");
  })
);

it.effect.each(["", "Wrong/Zone", "+03:00"])(
  "invalid event zone %s fails before planning a write",
  (zone) =>
    Effect.gen(function* invalidZone() {
      const actionFailure = yield* changeEventZone(editorDraft, zone).pipe(
        Effect.flip
      );

      expect(actionFailure.message).toContain("named time zone");

      const planFailure = yield* prepareEditor(
        sessionFor({ ...editorDraft, timeZone: zone })
      ).pipe(Effect.flip);

      expect(planFailure.message).toContain("named time zone");
    })
);

it.effect(
  "instances inherit a master's stored zone before viewer fallback, while all-day dates stay zone-free",
  () =>
    Effect.gen(function* inheritance() {
      const master = {
        ...editorOriginal,
        start: {
          dateTime: "2026-03-01T09:00:00-08:00",
          timeZone: "America/Los_Angeles",
        },
      };

      const instance = yield* eventDraft(editorOriginal, master, "Asia/Tokyo");
      expect(instance.timeZone).toBe("America/Los_Angeles");
      expect(instance.startTime).toBe("09:00");

      const own = yield* eventDraft(
        {
          ...editorOriginal,
          start: { dateTime: "2026-10-19T00:00:00Z", timeZone: "Asia/Tokyo" },
        },
        master,
        "UTC"
      );

      expect(own.timeZone).toBe("Asia/Tokyo");

      const fields = yield* draftEventFields({
        ...editorDraft,
        allDay: true,
        timeZone: "not-a-zone",
      });

      expect(fields.start).toEqual({ date: editorDraft.startDate });
      expect(fields.end).toEqual({ date: "2026-10-20" });
    })
);

it.effect(
  "new event defaults to the home zone, and a recurring calendar move plus zone change is refused before any write",
  () =>
    Effect.gen(function* creationAndMove() {
      const created = yield* createDraft({
        allDay: false,
        endDate: editorDraft.endDate,
        endTime: "10:00",
        ref: { accountId: "work", calendarId: "primary" },
        startDate: editorDraft.startDate,
        startTime: "09:00",
        timeZone: "America/Los_Angeles",
      });

      expect(created.timeZone).toBe("America/Los_Angeles");

      const failure = yield* prepareEditor(
        sessionFor({
          ...editorDraft,
          calendarId: "team",
          timeZone: "Asia/Tokyo",
        })
      ).pipe(Effect.flip);

      expect(failure.message).toContain("separately");
    })
);
