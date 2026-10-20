import { googleCalendarCapabilities } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { EditorAction } from "../src/client/editing/editor-action.js";
import { editorCalendars, renderEditorFixture } from "./editor-fixture.js";
import {
  applyReminderAction,
  createReminderSession,
  reminderEditorView,
} from "./reminder-editor-fixture.js";

it.effect.each([false, true])(
  "the actual picker offers exactly the E21 choices for allDay=%s and reflects creation defaults",
  (allDay) =>
    Effect.gen(function* reminderChoices() {
      const session = yield* createReminderSession(allDay);
      const rendered = yield* renderEditorFixture(reminderEditorView(session));

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      const choices = [
        ...document.querySelectorAll<HTMLOptionElement>(
          "[aria-label='Reminder suggestions'] option"
        ),
      ].filter((option) => option.value !== "");

      expect(choices.map((option) => Number(option.value))).toEqual(
        allDay ? [0, 1440, 2880, 4320, 10_080] : [0, 5, 10, 30, 60]
      );
      expect(
        document.querySelector<HTMLInputElement>("#event-defaultReminders")
          ?.checked
      ).toBe(!allDay);
      expect(
        document.querySelector<HTMLSelectElement>(
          "[aria-label='Reminder suggestions']"
        )?.disabled
      ).toBe(!allDay);
    })
);

it.effect.each([false, true])(
  "typed out-of-range validation is rendered without losing accepted reminders for allDay=%s",
  (allDay) =>
    Effect.gen(function* reminderValidation() {
      let session = yield* createReminderSession(allDay);

      if (session.draft.reminders.useDefault) {
        session = yield* applyReminderAction(
          session,
          EditorAction.cases.ToggleDefaultReminders.make({})
        );
      }

      session = yield* applyReminderAction(
        { ...session, draft: { ...session.draft, reminderInput: "672 hours" } },
        EditorAction.cases.AddReminder.make({})
      );

      const typed = {
        ...session,
        draft: { ...session.draft, reminderInput: "673 hours" },
      };

      const failure = yield* applyReminderAction(
        typed,
        EditorAction.cases.AddReminder.make({})
      ).pipe(Effect.flip);

      const rendered = yield* renderEditorFixture(
        reminderEditorView(typed, Option.some(failure.message))
      );

      const document = new DOMParser().parseFromString(
        rendered.html,
        "text/html"
      );

      expect(
        document.querySelector("#event-editor-dialog [role=alert]")?.textContent
      ).toContain("1 minute to 28 days");
      expect(
        document.querySelector<HTMLInputElement>("#event-reminderInput")?.value
      ).toBe("673 hours");
      expect(
        document.querySelector("[data-reminder-minutes='40320']")?.textContent
      ).toContain("Notification: 4 weeks before");
      expect(typed.draft.reminders.overrides).toHaveLength(allDay ? 1 : 2);
    })
);

it.effect(
  "calendar defaults, duplicate minute values and the provider maximum retain their existing picker guards",
  () =>
    Effect.gen(function* reminderGuards() {
      const initial = yield* createReminderSession(false);

      const inherited = new DOMParser().parseFromString(
        (yield* renderEditorFixture(reminderEditorView(initial))).html,
        "text/html"
      );

      expect(
        inherited.querySelector("[data-reminder-minutes='30']")
      ).not.toBeNull();
      expect(
        inherited.querySelector<HTMLInputElement>("#event-reminderInput")
          ?.disabled
      ).toBe(true);

      const custom = yield* applyReminderAction(
        initial,
        EditorAction.cases.ToggleDefaultReminders.make({})
      );

      const document = new DOMParser().parseFromString(
        (yield* renderEditorFixture(reminderEditorView(custom))).html,
        "text/html"
      );

      expect(
        document.querySelector<HTMLOptionElement>(
          "[aria-label='Reminder suggestions'] option[value='30']"
        )?.disabled
      ).toBe(true);
      expect(
        document.querySelector<HTMLOptionElement>(
          "[aria-label='Reminder suggestions'] option[value='60']"
        )?.disabled
      ).toBe(false);

      const limit = googleCalendarCapabilities.maxRemindersCount;

      const full = {
        ...custom,
        draft: {
          ...custom.draft,
          reminders: {
            overrides: Array.from(
              { length: limit },
              (_, index) =>
                ({
                  method: "popup",
                  minutes: index * 10,
                }) satisfies (typeof custom.draft.reminders.overrides)[number]
            ),
            useDefault: false,
          },
        },
      };

      const limited = new DOMParser().parseFromString(
        (yield* renderEditorFixture(reminderEditorView(full), editorCalendars))
          .html,
        "text/html"
      );

      expect(
        limited.querySelector<HTMLInputElement>("#event-reminderInput")
          ?.disabled
      ).toBe(true);
      expect(
        limited.querySelector<HTMLSelectElement>(
          "[aria-label='Reminder suggestions']"
        )?.disabled
      ).toBe(true);
      expect(limited.body.textContent).toContain(
        `Reminders limited to ${limit}`
      );
    })
);
