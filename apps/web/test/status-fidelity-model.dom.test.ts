import { Calendar, CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Result, Schema } from "effect";

import { ref } from "../../../packages/calendar/test/fake-google.js";
import { changeEditor } from "../src/client/editing/change-editor.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { LoadedEditor } from "../src/client/editing/editor-session-model.js";
import { prepareEditor } from "../src/client/editing/prepare-editor.js";
import { eventDraft } from "../src/layout/editor-draft.js";
import { dayFromIso, initialNavigation } from "../src/layout/navigation.js";

const modes = {
  all: "declineAllConflictingInvitations",
  missing: undefined,
  new: "declineOnlyNewConflictingInvitations",
  none: "declineNone",
} as const;

it.effect.prop(
  "generated saved-policy histories preserve unsupported policies and write matching properties only after a supported explicit change",
  {
    commands: Schema.Array(
      Schema.Literals(["title", "on", "off", "prepare"])
    ).check(Schema.isMinLength(1), Schema.isMaxLength(24)),
    mode: Schema.Literals(["none", "new", "all", "missing"]),
    type: Schema.Literals(["focusTime", "outOfOffice"]),
    writable: Schema.Boolean,
  },
  ({ mode, writable, type, commands }) =>
    Effect.gen(function* savedPolicyHistories() {
      const originalMode = modes[mode];
      const properties = { autoDeclineMode: originalMode };

      const original = CalendarEvent.make({
        ...ref,
        end: { dateTime: "2026-10-21T17:00:00Z" },
        eventId: "policy-event",
        eventType: type,
        organizer: { self: true },
        start: { dateTime: "2026-10-21T16:00:00Z" },
        status: "confirmed",
        title: "Source title",
        ...(type === "focusTime"
          ? { focusTimeProperties: properties }
          : { outOfOfficeProperties: properties }),
      });

      const draft = yield* eventDraft(
        original,
        undefined,
        "America/Los_Angeles"
      );

      const calendar = Calendar.make({
        ...ref,
        accessRole: writable ? "owner" : "reader",
        primary: true,
        timeZone: "America/Los_Angeles",
        title: "Work",
      });

      let session = LoadedEditor.make({
        baseline: draft,
        calendars: [calendar],
        createId: Option.none(),
        draft,
        id: "policy-session",
        kind: "edit",
        master: Option.none(),
        moveSupport: "notAvailable",
        navigation: initialNavigation(dayFromIso("2026-10-19")),
        operation: "save",
        original: Option.some(original),
        selection: Option.none(),
      });

      let expectedMode = originalMode;
      let titleNumber = 0;

      for (const command of [...commands, "prepare"]) {
        if (command === "prepare") {
          const result = yield* prepareEditor(session).pipe(Effect.result);
          expect(Result.isSuccess(result)).toBe(writable);

          if (Result.isSuccess(result)) {
            expect(result.success.changes.eventType).toBeUndefined();

            const changed =
              type === "focusTime"
                ? result.success.changes.focusTimeProperties
                : result.success.changes.outOfOfficeProperties;

            expect(changed).toEqual(
              expectedMode === originalMode
                ? undefined
                : { autoDeclineMode: expectedMode }
            );
            expect(
              type === "focusTime"
                ? result.success.changes.outOfOfficeProperties
                : result.success.changes.focusTimeProperties
            ).toBeUndefined();
            expect(result.success.sendUpdates).toBe("none");
          }

          continue;
        }

        const title = `Edited title ${titleNumber}`;
        titleNumber += 1;

        const action =
          command === "title"
            ? EditorAction.cases.TextEdited.make({
                field: "title",
                value: title,
              })
            : EditorAction.cases.StatusInvitationsChosen.make({
                value: command === "on",
              });

        const permitted =
          writable &&
          (command === "title" || mode === "none" || mode === "new");

        const result = yield* changeEditor({
          action,
          custom: Option.none(),
          session,
        }).pipe(Effect.result);

        expect(Result.isSuccess(result)).toBe(permitted);

        if (Result.isSuccess(result)) {
          session = result.success;

          if (command !== "title") {
            expectedMode =
              command === "on"
                ? "declineOnlyNewConflictingInvitations"
                : "declineNone";
          }
        }

        expect(session.draft.statusInvitationChoice).toBe(expectedMode);
        expect(session.baseline.statusInvitationChoice).toBe(originalMode);
      }
    })
);
