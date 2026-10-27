import type { CalendarEventValue } from "@calendar/calendar/contracts";
import {
  sameDesktopEventKey,
  trayRsvpNoteToken,
} from "@calendar/core/desktop-bridge";
import type { TrayRsvpNote } from "@calendar/core/desktop-bridge";
import { Option, Schema, Effect, Predicate } from "effect";
import { AsyncData, Command, Render } from "foldkit";
import type { Update } from "foldkit";

import { visibleEvents } from "../../layout/presentation.js";
import type { DisplayEvent } from "../../layout/presentation.js";
import { rsvpSelf } from "../../layout/rsvp-eligibility.js";
import type { AppModel, AppMessage } from "../app.js";
import { eventKey } from "../calendar-state.js";
import { DispatchEditing } from "../editing/commands.js";
import { responseIsBusy } from "../editing/response-availability.js";
import { PreparedRsvpNote } from "../editing/rsvp-machine.js";
import { EditingCommand } from "../editing/runtime.js";
import { Message } from "../message.js";
import { isPhoneShell } from "../phone-shell/model.js";
import { nativeNotificationLease } from "../reminders/native-projection.js";
import { desktopSelection } from "./selection.js";
import { agendaSnapshot } from "./snapshot.js";

export const rsvpNoteTarget = (
  model: AppModel,
  intent: typeof TrayRsvpNote.Type
): { display: DisplayEvent; source: CalendarEventValue } | undefined => {
  if (
    !Option.contains(model.person, intent.personId) ||
    nativeNotificationLease(model) !== intent.lease ||
    responseIsBusy(model)
  ) {
    return undefined;
  }

  const settings = AsyncData.getData(model.desktop.settings);

  const published = Option.isSome(settings)
    ? agendaSnapshot(model, settings.value.preferences).events.find(
        (event) =>
          sameDesktopEventKey(event.key, intent.key) &&
          event.start === intent.start &&
          event.rsvp?.enabled === true
      )
    : undefined;

  const display = desktopSelection(model, intent.key);

  const source = display?.copies.find((copy) =>
    sameDesktopEventKey(copy.source, intent.key)
  )?.source;

  return published !== undefined &&
    display !== undefined &&
    source !== undefined &&
    rsvpSelf(source) !== undefined
    ? { display, source }
    : undefined;
};

export const prepareRsvpNoteFromDesktop = (
  model: AppModel,
  intent: typeof TrayRsvpNote.Type
) => {
  const target = rsvpNoteTarget(model, intent);
  const current = model.editing.rsvp;

  if (target === undefined) {
    return {
      model: {
        ...model,
        error: Option.some(
          "This meeting is no longer available for a response note."
        ),
      },
    };
  }

  if (
    current.note.length > 0 &&
    Option.isSome(current.focused) &&
    eventKey(current.focused.value) !== eventKey(target.source)
  ) {
    return {
      model: {
        ...model,
        error: Option.some(
          "Finish or clear the current response note before opening another meeting."
        ),
      },
    };
  }

  return {
    commands: [
      DispatchEditing({
        command: EditingCommand.cases.RsvpPrepare.make({
          event: target.source,
          intent,
        }),
        personId: intent.personId,
      }),
    ],
    model: { ...model, error: Option.none() },
  };
};

export const newPreparedRsvpNote = (before: AppModel, after: AppModel) => {
  const previous = before.editing.rsvp.prepared;
  const next = after.editing.rsvp.prepared;

  return next !== undefined &&
    (previous === undefined ||
      trayRsvpNoteToken(previous.intent, previous.id) !==
        trayRsvpNoteToken(next.intent, next.id)) &&
    rsvpNoteTarget(after, next.intent) !== undefined
    ? next
    : undefined;
};

const readyNote = (
  model: AppModel
): Option.Option<{
  pane: "phone" | "desktop";
  prepared: typeof PreparedRsvpNote.Type;
}> => {
  const { prepared } = model.editing.rsvp;

  if (
    prepared === undefined ||
    !Predicate.isTagged(model.route, "Calendar") ||
    rsvpNoteTarget(model, prepared.intent) === undefined
  ) {
    return Option.none();
  }

  const selected = visibleEvents(model).find(
    (event) =>
      event.selected &&
      event.copies.some((copy) =>
        sameDesktopEventKey(copy.source, prepared.intent.key)
      )
  );

  return selected === undefined
    ? Option.none()
    : Option.some({
        pane: isPhoneShell(model) ? "phone" : "desktop",
        prepared,
      });
};

export const FocusRsvpNote = Command.define("FocusRsvpNote", {
  args: {
    pane: Schema.Literals(["phone", "desktop"]),
    prepared: PreparedRsvpNote,
  },
  execute: ({ pane, prepared }) =>
    Render.afterCommit.pipe(
      Effect.andThen(
        Effect.sync(() => {
          const token = trayRsvpNoteToken(prepared.intent, prepared.id);

          const target = [
            ...document.querySelectorAll<HTMLTextAreaElement>(
              "textarea[data-tray-rsvp-note]"
            ),
          ].find(
            (element) =>
              element.dataset.trayRsvpNote === token &&
              (pane === "phone"
                ? element.closest("#phone-shell-dialog") !== null
                : element.closest("#phone-shell-dialog") === null)
          );

          target?.focus();

          return Message.CompletedRsvpNoteFocus();
        })
      )
    ),
  messages: [Message.CompletedRsvpNoteFocus],
});

export const withRsvpNoteFocus = <R>(
  before: AppModel,
  result: Update.Return<AppModel, AppMessage, R>
) => {
  const next = Option.getOrUndefined(readyNote(result.model));
  const previous = Option.getOrUndefined(readyNote(before));
  const { prepared } = before.editing.rsvp;

  const selectionChanged =
    JSON.stringify(before.calendar.selected) !==
    JSON.stringify(result.model.calendar.selected);

  const selectedTarget =
    prepared === undefined
      ? undefined
      : desktopSelection(result.model, prepared.intent.key);

  if (
    prepared !== undefined &&
    result.model.editing.rsvp.prepared?.id === prepared.id &&
    Option.contains(result.model.person, prepared.intent.personId) &&
    selectionChanged &&
    (selectedTarget === undefined ||
      !result.model.calendar.selected.includes(selectedTarget.key))
  ) {
    return {
      ...result,
      commands: [
        ...(result.commands ?? []),
        DispatchEditing({
          command: EditingCommand.cases.RsvpClearPreparation.make({ prepared }),
          personId: prepared.intent.personId,
        }),
      ],
    };
  }

  if (
    result.commands?.some((command) => command.name === "FocusRsvpNote") ===
    true
  ) {
    return result;
  }

  if (
    next === undefined ||
    (previous !== undefined &&
      previous.pane === next.pane &&
      trayRsvpNoteToken(previous.prepared.intent, previous.prepared.id) ===
        trayRsvpNoteToken(next.prepared.intent, next.prepared.id))
  ) {
    return result;
  }

  return {
    ...result,
    commands: [
      ...(result.commands ?? []),
      FocusRsvpNote({
        pane: next.pane === "phone" ? "phone" : "desktop",
        prepared: next.prepared,
      }),
    ],
  };
};
