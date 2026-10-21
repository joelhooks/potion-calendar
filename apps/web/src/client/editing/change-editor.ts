import {
  googleCalendarCapabilities,
  statusEventType,
} from "@calendar/calendar/contracts";
import { createEffectLogic } from "@xstate/effect";
import { Effect, Match, Schema } from "effect";

import { eventPalette } from "../../layout/colors.js";
import { addParticipant, customReminders } from "../../layout/editor-fields.js";
import {
  addReminder,
  parseReminderInput,
} from "../../layout/editor-reminders.js";
import { repeatRules } from "../../layout/editor-repeat.js";
import { changeEventZone } from "../../layout/editor-zone.js";
import {
  applyEditorConferencingDefault,
  editorMeetUnavailable,
  editorNeedsConferenceReplacement,
  requestEditorConferencing,
} from "./conferencing-draft.js";
import { EditorAction } from "./editor-action.js";
import { RepeatPreset } from "./editor-model.js";
import {
  EditorChangeInput,
  EditorChangeResult,
} from "./editor-session-model.js";
import type { LoadedEditor } from "./editor-session-model.js";
import { EditorInputFailure } from "./input-failure.js";
import { permissionsForEditor } from "./prepare-editor.js";
import { selectCreateEventType } from "./status-event-draft.js";
import { statusPolicyUnavailable } from "./status-event-policy.js";

const CalendarChoice = Schema.fromJsonString(
  Schema.Tuple([Schema.String, Schema.String])
);

const fail = () =>
  new EditorInputFailure({
    message:
      "This control is not editable with the permissions Google provided.",
  });

const newReminder = Effect.fn("changeEditorReminder")(function* newReminder(
  session: typeof LoadedEditor.Type,
  suggestion?: string
) {
  const calendar = session.calendars.find(
    (item) =>
      item.accountId === session.draft.accountId &&
      item.calendarId === session.draft.calendarId
  );

  const draft = customReminders(session.draft, calendar?.defaultReminders);

  const minutes =
    suggestion === undefined
      ? yield* parseReminderInput(draft.reminderInput)
      : yield* Schema.decodeEffect(
          Schema.FiniteFromString.check(
            Schema.isInt(),
            Schema.isGreaterThanOrEqualTo(0)
          )
        )(suggestion).pipe(
          Effect.mapError(
            () =>
              new EditorInputFailure({
                message: "Choose a valid reminder suggestion.",
              })
          )
        );

  const overrides = yield* addReminder(
    draft.reminders.overrides,
    minutes,
    googleCalendarCapabilities.maxRemindersCount
  );

  return {
    ...session,
    draft: {
      ...draft,
      reminderInput: "",
      reminders: { overrides, useDefault: false },
    },
  };
});

export const changeEditor = Effect.fn("changeEditor")(function* changeEditor(
  input: typeof EditorChangeInput.Type
) {
  const { action, session } = input;
  const permissions = permissionsForEditor(session);

  return yield* EditorAction.matchOrElse<
    Effect.Effect<typeof LoadedEditor.Type, EditorInputFailure>
  >(
    action,
    {
      AddMeet: () => {
        const reason = editorMeetUnavailable(session, permissions.editMeeting);

        if (reason !== undefined || editorNeedsConferenceReplacement(session)) {
          return Effect.fail(
            new EditorInputFailure({
              message:
                reason ?? "Confirm replacing the existing conferencing first.",
            })
          );
        }

        return Effect.succeed({
          ...session,
          draft: requestEditorConferencing(session, { kind: "googleMeet" }),
        });
      },
      AddParticipant: () =>
        permissions.inviteGuests
          ? addParticipant(session.draft).pipe(
              Effect.map((draft) => ({
                ...session,
                draft: applyEditorConferencingDefault({ ...session, draft }),
              }))
            )
          : Effect.fail(fail()),
      AddReminder: () =>
        permissions.calendarWritable
          ? newReminder(session)
          : Effect.fail(fail()),
      CalendarSelected: ({ value }) =>
        Effect.gen(function* calendarSelected() {
          const [accountId, calendarId] = yield* Schema.decodeEffect(
            CalendarChoice
          )(value).pipe(
            Effect.mapError(
              () =>
                new EditorInputFailure({ message: "Choose a listed calendar." })
            )
          );

          const calendar = session.calendars.find(
            (item) =>
              item.accountId === accountId && item.calendarId === calendarId
          );

          if (
            calendar === undefined ||
            (calendar.accessRole !== "owner" &&
              calendar.accessRole !== "writer") ||
            (session.kind === "edit" &&
              accountId !== session.baseline.accountId)
          ) {
            return yield* new EditorInputFailure({
              message:
                "Choose a writable calendar in the same account for an existing event.",
            });
          }

          return {
            ...session,
            draft: { ...session.draft, accountId, calendarId },
          };
        }),
      ColorSelected: ({ value }) => {
        if (
          !permissions.calendarWritable ||
          (value !== null &&
            !eventPalette.some(
              (colour) => colour.google !== "" && colour.google === value
            ))
        ) {
          return Effect.fail(fail());
        }

        return Effect.succeed({
          ...session,
          draft: { ...session.draft, colorId: value },
        });
      },
      ConfirmConferencing: () => {
        const reason = editorMeetUnavailable(session, permissions.editMeeting);

        return reason === undefined
          ? Effect.succeed({
              ...session,
              draft: requestEditorConferencing(session, { kind: "googleMeet" }),
            })
          : Effect.fail(new EditorInputFailure({ message: reason }));
      },
      EventTypeSelected: ({ value }) =>
        permissions.editMeeting
          ? selectCreateEventType(session, value)
          : Effect.fail(fail()),
      ParticipantOptional: ({ email }) =>
        permissions.editGuests
          ? Effect.succeed({
              ...session,
              draft: {
                ...session.draft,
                attendees: session.draft.attendees.map((person) =>
                  person.email === email &&
                  person.self !== true &&
                  person.organizer !== true
                    ? { ...person, optional: person.optional !== true }
                    : person
                ),
              },
            })
          : Effect.fail(fail()),
      RemoveConferencing: () =>
        permissions.editMeeting
          ? Effect.succeed({
              ...session,
              draft: requestEditorConferencing(session, { kind: "none" }),
            })
          : Effect.fail(fail()),
      RemoveParticipant: ({ email }) =>
        permissions.editGuests
          ? Effect.succeed({
              ...session,
              draft: {
                ...session.draft,
                attendees: session.draft.attendees.filter(
                  (person) =>
                    person.email !== email ||
                    person.self === true ||
                    person.organizer === true
                ),
              },
            })
          : Effect.fail(fail()),
      RemoveReminder: ({ reminder }) => {
        const { draft } = session;

        return permissions.calendarWritable
          ? Effect.succeed({
              ...session,
              draft: {
                ...draft,
                reminders: {
                  overrides: draft.reminders.overrides.filter(
                    (item) =>
                      item.method !== reminder.method ||
                      item.minutes !== reminder.minutes
                  ),
                  useDefault: false,
                },
              },
            })
          : Effect.fail(fail());
      },
      RepeatAccepted: () =>
        Effect.gen(function* acceptCustomRepeat() {
          const repeat = yield* Effect.fromOption(input.custom).pipe(
            Effect.mapError(
              () =>
                new EditorInputFailure({
                  message: "The custom repeat form is unavailable.",
                })
            )
          );

          yield* repeatRules({
            allDay: session.draft.allDay,
            repeat,
            startDate: session.draft.startDate,
            timeZone: session.draft.timeZone,
          });

          return { ...session, draft: { ...session.draft, repeat } };
        }),
      RepeatPresetSelected: ({ value }) =>
        Schema.decodeUnknownEffect(RepeatPreset)(value).pipe(
          Effect.mapError(
            () =>
              new EditorInputFailure({
                message: "Choose a supported repeat pattern.",
              })
          ),
          Effect.map((preset) => ({
            ...session,
            draft: {
              ...session.draft,
              repeat: { ...session.draft.repeat, preset },
            },
          }))
        ),
      StatusInvitationsChosen: ({ value }) => {
        const reason = statusPolicyUnavailable(
          session,
          permissions.editMeeting
        );

        return reason === undefined
          ? Effect.succeed({
              ...session,
              draft: {
                ...session.draft,
                statusInvitationChoice: value
                  ? "declineOnlyNewConflictingInvitations"
                  : "declineNone",
              },
            })
          : Effect.fail(new EditorInputFailure({ message: reason }));
      },
      SuggestReminder: ({ value }) =>
        permissions.calendarWritable
          ? newReminder(session, value)
          : Effect.fail(fail()),
      TextEdited: ({ field, value }) => {
        if (
          statusEventType(session.draft.eventType) &&
          (field === "location" || field === "description")
        ) {
          return Effect.fail(fail());
        }

        const permitted = Match.value(field).pipe(
          Match.when("reminderInput", () => permissions.calendarWritable),
          Match.when("participantEmail", () => permissions.inviteGuests),
          Match.orElse(() => permissions.editMeeting)
        );

        return permitted
          ? Effect.succeed({
              ...session,
              draft: { ...session.draft, [field]: value },
            })
          : Effect.fail(fail());
      },
      TimeZoneSelected: ({ value }) =>
        permissions.editMeeting
          ? changeEventZone(session.draft, value).pipe(
              Effect.map((draft) => ({ ...session, draft }))
            )
          : Effect.fail(fail()),
      ToggleAllDay: () =>
        permissions.editMeeting &&
        !(session.kind === "edit" && statusEventType(session.draft.eventType))
          ? Effect.succeed({
              ...session,
              draft: { ...session.draft, allDay: !session.draft.allDay },
            })
          : Effect.fail(fail()),
      ToggleDefaultReminders: () => {
        const calendar = session.calendars.find(
          (item) =>
            item.accountId === session.draft.accountId &&
            item.calendarId === session.draft.calendarId
        );

        return permissions.calendarWritable
          ? Effect.succeed({
              ...session,
              draft: {
                ...session.draft,
                reminders: session.draft.reminders.useDefault
                  ? {
                      overrides: calendar?.defaultReminders ?? [],
                      useDefault: false,
                    }
                  : { overrides: [], useDefault: true },
              },
            })
          : Effect.fail(fail());
      },
    },
    () => Effect.succeed(session)
  );
});

export const changeEditorLogic = createEffectLogic({
  effect: ({ input }) =>
    changeEditor(input).pipe(
      Effect.match({
        onFailure: (failure) =>
          EditorChangeResult.cases.Invalid.make({ message: failure.message }),
        onSuccess: (session) =>
          EditorChangeResult.cases.Changed.make({ session }),
      })
    ),
  schemas: { input: EditorChangeInput },
});
