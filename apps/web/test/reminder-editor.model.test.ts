import {
  Reminder,
  googleCalendarCapabilities,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorInputFailure } from "../src/client/editing/input-failure.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { createDraft, eventDraft } from "../src/layout/editor-draft.js";
import { draftEventFields } from "../src/layout/editor-fields.js";
import { editorOriginal } from "./editor-fixture.js";
import {
  applyReminderAction,
  createReminderSession,
  reminderSession,
} from "./reminder-editor-fixture.js";

it.effect.prop(
  "ordinary date-only creation clears inherited reminders while timed creation keeps calendar defaults through write planning",
  {
    allDay: Schema.Boolean,
    day: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(1),
      Schema.isLessThanOrEqualTo(28)
    ),
    zone: Schema.Literals(["UTC", "America/Los_Angeles", "Asia/Tokyo"]),
  },
  ({ allDay, day, zone }) =>
    Effect.gen(function* initialReminderPolicy() {
      const date = `2026-10-${String(day).padStart(2, "0")}`;

      const draft = yield* createDraft({
        allDay,
        endDate: date,
        endTime: "10:00",
        ref: { accountId: "work", calendarId: "primary" },
        startDate: date,
        startTime: "09:00",
        timeZone: zone,
      });

      const expected = allDay
        ? { overrides: [], useDefault: false }
        : { useDefault: true };

      expect(draft.reminders).toEqual({ overrides: [], useDefault: !allDay });
      expect((yield* draftEventFields(draft)).reminders).toEqual(expected);
      expect(
        (yield* prepareEditor(reminderSession(draft))).fields.reminders
      ).toEqual(expected);
    })
);

it.effect.prop(
  "loading an existing timed or date-only event preserves its saved reminder policy rather than applying creation defaults",
  {
    allDay: Schema.Boolean,
    overrides: Schema.Array(Reminder).check(
      Schema.isMaxLength(googleCalendarCapabilities.maxRemindersCount)
    ),
    useDefault: Schema.Boolean,
  },
  ({ allDay, overrides, useDefault }) =>
    Effect.gen(function* existingReminderPolicy() {
      const reminders = { overrides, useDefault };

      const event = {
        ...editorOriginal,
        end: allDay ? { date: "2026-10-20" } : editorOriginal.end,
        reminders,
        start: allDay ? { date: "2026-10-19" } : editorOriginal.start,
      };

      const draft = yield* eventDraft(event, undefined, "America/Los_Angeles");

      expect(draft.reminders).toEqual(reminders);
    })
);

it.effect.each([
  { input: "1 minute", minutes: 1 },
  { input: "672 hours", minutes: 40_320 },
  { input: "28 days", minutes: 40_320 },
  { input: "4 weeks", minutes: 40_320 },
  { input: "0.5h", minutes: 30 },
])(
  "typed reminder action accepts $input and clears only accepted input",
  ({ input, minutes }) =>
    Effect.gen(function* acceptedTypedReminder() {
      const session = yield* createReminderSession(true);

      const typed = {
        ...session,
        draft: { ...session.draft, reminderInput: input },
      };

      const changed = yield* applyReminderAction(
        typed,
        EditorAction.cases.AddReminder.make({})
      );

      expect(changed.draft.reminders).toEqual({
        overrides: [{ method: "popup", minutes }],
        useDefault: false,
      });
      expect(changed.draft.reminderInput).toBe("");
      expect(changed.baseline).toBe(session.baseline);
    })
);

it.effect.each([
  "0m",
  "-1m",
  "1.5m",
  "673h",
  "672h1m",
  "29 days",
  "not a duration",
])(
  "typed reminder action refuses %s without changing the draft or its saved baseline",
  (input) =>
    Effect.gen(function* refusedTypedReminder() {
      const session = yield* createReminderSession(true);

      const typed = {
        ...session,
        draft: { ...session.draft, reminderInput: input },
      };

      const before = structuredClone(typed.draft);

      const failure = yield* applyReminderAction(
        typed,
        EditorAction.cases.AddReminder.make({})
      ).pipe(Effect.flip);

      expect(Schema.is(EditorInputFailure)(failure)).toBe(true);
      expect(failure.message).toContain("1 minute to 28 days");
      expect(typed.draft).toEqual(before);
      expect(typed.baseline).toBe(session.baseline);
    })
);

it.effect(
  "preset zero, duplicate minutes, removal and provider-owned capacity use the existing action path",
  () =>
    Effect.gen(function* reminderActionGuards() {
      const initial = yield* createReminderSession(true);

      const zero = yield* applyReminderAction(
        initial,
        EditorAction.cases.SuggestReminder.make({ value: "0" })
      );

      const duplicate = yield* applyReminderAction(
        zero,
        EditorAction.cases.SuggestReminder.make({ value: "0" })
      ).pipe(Effect.flip);

      expect(zero.draft.reminders.overrides).toEqual([
        { method: "popup", minutes: 0 },
      ]);
      expect(duplicate.message).toBe("That reminder is already selected.");

      const removed = yield* applyReminderAction(
        zero,
        EditorAction.cases.RemoveReminder.make({
          reminder: { method: "popup", minutes: 0 },
        })
      );

      expect(removed.draft.reminders).toEqual({
        overrides: [],
        useDefault: false,
      });

      const limit = googleCalendarCapabilities.maxRemindersCount;

      const full = {
        ...initial,
        draft: {
          ...initial.draft,
          reminders: {
            overrides: Array.from(
              { length: limit },
              (_, minutes) =>
                ({ method: "popup", minutes }) satisfies typeof Reminder.Type
            ),
            useDefault: false,
          },
        },
      };

      const failure = yield* applyReminderAction(
        full,
        EditorAction.cases.SuggestReminder.make({ value: "60" })
      ).pipe(Effect.flip);

      expect(failure.message).toBe(`Reminders limited to ${limit}`);
      expect(full.draft.reminders.overrides).toHaveLength(limit);
    })
);
