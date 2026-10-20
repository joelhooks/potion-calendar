import {
  Reminder,
  googleCalendarCapabilities,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Schema } from "effect";

import { EditorInputFailure } from "../src/client/editing/input-failure.js";
import { eventDraft } from "../src/layout/editor-draft.js";
import {
  addParticipant,
  draftChanges,
  draftEventFields,
} from "../src/layout/editor-fields.js";
import {
  addReminder,
  parseReminderInput,
} from "../src/layout/editor-reminders.js";
import { repeatRules } from "../src/layout/editor-repeat.js";
import { editorLocalTime } from "../src/layout/editor-time.js";
import { editorDraft, editorOriginal } from "./editor-fixture.js";

it.effect.prop(
  "typed minute reminders preserve every positive value accepted by the shared provider schema",
  { minutes: Reminder.fields.minutes.check(Schema.isGreaterThan(0)) },
  ({ minutes }) =>
    Effect.gen(function* reminderRoundtrip() {
      expect(yield* parseReminderInput(`${minutes}m`)).toBe(minutes);
    })
);

it.effect.each([
  { input: "2h45m", minutes: 165 },
  { input: "1 day 2 hours", minutes: 1560 },
  { input: "0.5h", minutes: 30 },
  { input: "4 weeks", minutes: 40_320 },
])("compound reminder: $input", ({ input, minutes }) =>
  Effect.gen(function* compoundReminder() {
    expect(yield* parseReminderInput(input)).toBe(minutes);
  })
);

it.effect.each(["0m", "-5m", "1.5m", "garbage", "99999999w"])(
  "invalid typed reminder: %s",
  (input) =>
    Effect.gen(function* refusedReminder() {
      const failure = yield* parseReminderInput(input).pipe(Effect.flip);
      expect(Schema.is(EditorInputFailure)(failure)).toBe(true);
    })
);

it.effect(
  "At start is selectable but duplicates and the provider reminder count cannot be exceeded",
  () =>
    Effect.gen(function* reminderSelection() {
      const limit = googleCalendarCapabilities.maxRemindersCount;
      const first = yield* addReminder([], 0, limit);
      expect(first).toEqual([{ method: "popup", minutes: 0 }]);
      expect(
        Schema.is(EditorInputFailure)(
          yield* addReminder(first, 0, limit).pipe(Effect.flip)
        )
      ).toBe(true);

      const full = Array.from(
        { length: limit },
        (_, index) =>
          ({ method: "popup", minutes: index }) satisfies typeof Reminder.Type
      );

      expect(
        Schema.is(EditorInputFailure)(
          yield* addReminder(full, limit, limit).pipe(Effect.flip)
        )
      ).toBe(true);
    })
);

it.effect(
  "local editing rejects invalid dates and DST gaps while repeated time uses the pinned compatible interpretation",
  () =>
    Effect.sync(() => {
      expect(
        Option.isNone(
          editorLocalTime("2026-02-30", "09:00", "America/Los_Angeles")
        )
      ).toBe(true);
      expect(
        Option.isNone(
          editorLocalTime("2026-03-08", "02:30", "America/Los_Angeles")
        )
      ).toBe(true);

      const repeated = editorLocalTime(
        "2026-11-01",
        "01:30",
        "America/Los_Angeles"
      );

      expect(repeated.pipe(Option.map(DateTime.formatIso))).toEqual(
        Option.some("2026-11-01T08:30:00.000Z")
      );
    })
);

it.effect(
  "all-day editing displays the inclusive last day and sends an exclusive provider end date",
  () =>
    Effect.gen(function* allDayBoundary() {
      const source = {
        ...editorOriginal,
        end: { date: "2026-10-22" },
        start: { date: "2026-10-19" },
      };

      const draft = yield* eventDraft(source, undefined, "America/Los_Angeles");
      expect(draft.endDate).toBe("2026-10-21");
      const fields = yield* draftEventFields(draft);
      expect(fields.start).toEqual({ date: "2026-10-19" });
      expect(fields.end).toEqual({ date: "2026-10-22" });
    })
);

it.effect(
  "an unrelated text edit never rewrites original instants, guest responses or provider recurrence",
  () =>
    Effect.gen(function* sparseEdit() {
      const source = {
        ...editorOriginal,
        end: { dateTime: "2026-10-19T10:00:57-07:00" },
        start: { dateTime: "2026-10-19T09:00:23-07:00" },
      };

      const baseline = yield* eventDraft(
        source,
        undefined,
        "America/Los_Angeles"
      );

      const draft = { ...baseline, title: "Changed title" };

      const delta = draftChanges(
        draft,
        baseline,
        yield* draftEventFields(draft)
      );

      expect(delta.changes).toEqual({ title: "Changed title" });
      expect(delta.noEmailOnly).toBe(false);
    })
);

it.effect(
  "time-only edits do not claim a calendar-day change and recurrence removal uses its explicit flag",
  () =>
    Effect.gen(function* scopeFacts() {
      const moved = { ...editorDraft, endTime: "11:00", startTime: "10:00" };

      const delta = draftChanges(
        moved,
        editorDraft,
        yield* draftEventFields(moved)
      );

      expect(delta.dayChanged).toBe(false);
      expect(delta.changes.start).toEqual({
        dateTime: "2026-10-19T17:00:00.000Z",
        timeZone: "America/Los_Angeles",
      });

      const removed = {
        ...editorDraft,
        repeat: { ...editorDraft.repeat, preset: "none" },
      } satisfies typeof editorDraft;

      const removal = draftChanges(
        removed,
        editorDraft,
        yield* draftEventFields(removed)
      );

      expect(removal.removeRecurrence).toBe(true);
      expect(removal.changes).not.toHaveProperty("recurrence");
    })
);

it.effect(
  "repeat production preserves opaque rules and only produces the chosen weekly pattern and stopping condition",
  () =>
    Effect.gen(function* recurrenceProducer() {
      const input = {
        allDay: false,
        repeat: editorDraft.repeat,
        startDate: editorDraft.startDate,
        timeZone: editorDraft.timeZone,
      };

      expect(yield* repeatRules(input)).toEqual(editorDraft.repeat.rules);

      const custom = {
        ...editorDraft.repeat,
        count: "10",
        end: "after",
        interval: "2",
        preset: "custom",
        weekdays: ["MO", "WE"],
      } satisfies typeof editorDraft.repeat;

      expect(yield* repeatRules({ ...input, repeat: custom })).toEqual([
        "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10",
      ]);
      expect(
        yield* repeatRules({
          ...input,
          repeat: { ...custom, end: "on", until: "2026-12-31" },
        })
      ).toEqual([
        "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20270101T075959Z",
      ]);
      expect(
        yield* repeatRules({
          ...input,
          allDay: true,
          repeat: { ...custom, end: "on", until: "2026-12-31" },
        })
      ).toEqual(["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231"]);
    })
);

it.effect(
  "participant entry validates addresses and does not duplicate case-insensitive membership",
  () =>
    Effect.gen(function* participantEntry() {
      const added = yield* addParticipant({
        ...editorDraft,
        participantEmail: "new@example.test",
      });

      expect(added.attendees.at(-1)).toMatchObject({
        email: "new@example.test",
        optional: false,
        responseStatus: "needsAction",
      });
      expect(added.participantEmail).toBe("");
      expect(
        Schema.is(EditorInputFailure)(
          yield* addParticipant({
            ...added,
            participantEmail: "NEW@example.test",
          }).pipe(Effect.flip)
        )
      ).toBe(true);
      expect(
        Schema.is(EditorInputFailure)(
          yield* addParticipant({
            ...added,
            participantEmail: "not-an-address",
          }).pipe(Effect.flip)
        )
      ).toBe(true);
    })
);
