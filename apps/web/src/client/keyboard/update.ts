import { Option, Match, Predicate, Schema } from "effect";
import type { Update } from "foldkit";

import { visibleEvents } from "../../layout/presentation.js";
import { CalendarRoute, ShortcutsRoute } from "../../layout/route.js";
import {
  primarySelection,
  changeSelection,
  SelectionAction,
} from "../../layout/selection-set.js";
import type { AppModel } from "../app.js";
import { bulkSummary } from "../bulk/selection.js";
import { eventKey } from "../calendar-state.js";
import type { ClipboardRuntime } from "../clipboard/runtime.js";
import { SavePreferences, ScrollToSelection } from "../commands.js";
import { commandTypeChoices } from "../editing/create-type-choices.js";
import { EditorAction } from "../editing/editor-action.js";
import { currentConversion, EditorView } from "../editing/editor-model.js";
import type { EditingRuntime } from "../editing/runtime.js";
import { editAction } from "../editing/update.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import type { MonthRuntime } from "../month/runtime.js";
import type { CalendarSearchClient } from "../search/client.js";
import type { SearchRuntime } from "../search/runtime.js";
import {
  OccurrenceNotice,
  OccurrenceTask,
} from "../selection-commands/model.js";
import { occurrenceContext } from "../selection-commands/source.js";
import { selectionRangeDays } from "../selection/range.js";
import { preferenceSnapshot } from "../settings/update.js";
import { calendarVisible, chooseVisibility } from "../settings/visibility.js";
import { timeGridGeometry } from "../time-blocks/grid.js";
import { FocusShortcutSearch, OpenProviderOriginal } from "./browser.js";
import { commandChoices, enterChoice, moveHighlight } from "./choices.js";
import { resolveBinding } from "./input.js";
import type { KeyboardInput } from "./input.js";
import { PanelAction, panelAction } from "./panels.js";
import {
  availableEventColors,
  calendarWritable,
  editableSelection,
  selectedColorEvent,
  selectedEvent,
  selectedProviderOriginal,
  selectedNavigationEvent,
  selectedRecurringReadEvent,
} from "./registry.js";
import { ColorOpening } from "./state.js";

export type KeyboardResult = Update.Return<
  AppModel,
  AppMessage,
  | EditingRuntime
  | CalendarSearchClient
  | SearchRuntime
  | ClipboardRuntime
  | MonthRuntime
>;

type Apply = (model: AppModel, message: AppMessage) => KeyboardResult;

export const closeKeyboard = (model: AppModel): AppModel => ({
  ...model,
  keyboard: {
    ...model.keyboard,
    deadline: 0,
    highlighted: "",
    prefix: "",
    query: "",
    screen: "closed",
  },
});

const selection = (model: AppModel, direction: -1 | 1): KeyboardResult => {
  const events = visibleEvents(model).toSorted(
    (a, b) =>
      a.startDay - b.startDay ||
      a.startMinute - b.startMinute ||
      a.key.localeCompare(b.key)
  );

  const index = events.findIndex((event) =>
    Option.contains(primarySelection(model.calendar.selected), event.key)
  );

  const start = direction === 1 ? 0 : events.length - 1;

  const next =
    index === -1 ? start : (index + direction + events.length) % events.length;

  const cursor = Option.fromUndefinedOr(events[next]?.key);

  return {
    model: {
      ...model,
      calendar: { ...model.calendar, selected: Option.toArray(cursor) },
      keyboard: { ...model.keyboard, cursor },
    },
  };
};

const dismiss = (model: AppModel, apply: Apply): KeyboardResult => {
  if (!EditorView.guards.Closed(model.editing.view)) {
    return editAction(
      { ...model, keyboard: { ...model.keyboard, opening: "none" } },
      EditorAction.cases.Cancel.make({})
    );
  }

  if (model.keyboard.screen !== "closed") {
    return { model: closeKeyboard(model) };
  }

  if (Predicate.isTagged(model.route, "Settings")) {
    return apply(
      closeKeyboard(model),
      Message.RequestedRoute({ replace: true, route: CalendarRoute.make({}) })
    );
  }

  return Predicate.isTagged(model.route, "Shortcuts")
    ? apply(closeKeyboard(model), Message.RequestedRouteBack())
    : apply(model, Message.ClosedDetail());
};

const nextPeriod = (
  model: AppModel,
  direction: -1 | 1,
  apply: Apply
): KeyboardResult => {
  const { navigation } = model.calendar;

  return navigation.mode === "month" ||
    navigation.mode === "day" ||
    (navigation.mode === "days" && navigation.days === 1)
    ? apply(model, Message.ClickedPage({ direction }))
    : apply(
        model,
        Message.KeyboardDate({ day: navigation.anchor + direction * 7 })
      );
};

const openScreen = (
  model: AppModel,
  screen:
    | "commands"
    | "days"
    | "date"
    | "event-zone"
    | "event-type"
    | "weekdays"
    | "theme"
    | "week-start"
    | "colors"
): KeyboardResult =>
  (screen === "colors" && selectedColorEvent(model) === undefined) ||
  (screen === "event-type" &&
    commandTypeChoices(model.editing, model.calendar.calendars).length === 0)
    ? { model }
    : {
        model: {
          ...model,
          keyboard: {
            ...model.keyboard,
            highlighted: "",
            prefix: "",
            query: "",
            screen:
              model.keyboard.screen === screen && screen !== "days"
                ? "closed"
                : screen,
          },
        },
      };

const openingScreen = Schema.Literals([
  "commands",
  "days",
  "date",
  "event-zone",
  "event-type",
  "weekdays",
  "theme",
  "week-start",
  "colors",
]);

const openEvent = (model: AppModel, apply: Apply): KeyboardResult => {
  if (
    !EditorView.guards.Closed(model.editing.view) ||
    selectedEvent(model) === undefined
  ) {
    return { model };
  }

  return calendarWritable(model)
    ? editAction(
        {
          ...model,
          keyboard: {
            ...model.keyboard,
            focus: "event-title",
            opening: "none",
          },
        },
        EditorAction.cases.OpenEdit.make({})
      )
    : apply(model, Message.KeyboardAction({ id: "show-context" }));
};

const SelectionKeyboardAction = Schema.Literals([
  "undo",
  "next-selection",
  "previous-selection",
  "toggle-selection",
  "select-all",
]);

const selectionAction = (
  model: AppModel,
  id: typeof SelectionKeyboardAction.Type,
  apply: Apply
): KeyboardResult => {
  switch (id) {
    case "undo": {
      const conversion = currentConversion(model.editing.view);

      if (conversion !== undefined) {
        return editAction(
          model,
          EditorAction.cases.UndoConversion.make({ id: conversion.id })
        );
      }

      if ((bulkSummary(model)?.undo.length ?? 0) > 0) {
        return apply(model, Message.BulkControl({ control: "undo" }));
      }

      const mark = model.editing.deletes.findLast(
        (item) => item.phase === "pending"
      );

      return mark === undefined
        ? { model }
        : editAction(
            model,
            EditorAction.cases.Undo.make({ id: mark.intent.id })
          );
    }

    case "next-selection": {
      return selection(model, 1);
    }

    case "previous-selection": {
      return selection(model, -1);
    }

    case "toggle-selection": {
      const cursor = Option.orElse(model.keyboard.cursor, () =>
        primarySelection(model.calendar.selected)
      );

      const selected = Option.match(cursor, {
        onNone: () => model.calendar.selected,
        onSome: (key) =>
          changeSelection(
            model.calendar.selected,
            SelectionAction.cases.Toggle.make({ key })
          ),
      });

      return {
        model: {
          ...model,
          calendar: { ...model.calendar, selected },
          keyboard: { ...model.keyboard, cursor },
        },
      };
    }

    case "select-all": {
      const days = selectionRangeDays(model);

      const visible = visibleEvents(model)
        .filter((event) =>
          days.some((day) => event.startDay <= day && event.endDay > day)
        )
        .map((event) => event.key);

      return {
        model: {
          ...model,
          calendar: {
            ...model.calendar,
            selected: changeSelection(
              model.calendar.selected,
              SelectionAction.cases.SelectAll.make({ visible })
            ),
          },
        },
      };
    }

    default: {
      return { model };
    }
  }
};

export const goToSelection = (
  model: AppModel,
  apply: Apply
): KeyboardResult => {
  const event = selectedNavigationEvent(model);
  const person = Option.getOrUndefined(model.person);

  if (event === undefined || person === undefined) {
    return { model };
  }

  const revealed = !calendarVisible(
    event.calendar,
    model.calendar.visibility,
    model.calendar.visibilityMigration
  );

  const visibility = revealed
    ? chooseVisibility(
        model.calendar.calendars,
        model.calendar.visibility,
        model.calendar.visibilityMigration,
        event.calendar,
        true
      )
    : { hidden: model.calendar.hidden, visibility: model.calendar.visibility };

  const shown = {
    ...closeKeyboard(model),
    calendar: { ...model.calendar, ...visibility },
  };

  const navigated = apply(
    shown,
    Message.KeyboardDate({ day: event.startDay, revealSelection: true })
  );

  const routed: KeyboardResult = Predicate.isTagged(
    navigated.model.route,
    "Calendar"
  )
    ? { model: navigated.model }
    : apply(
        navigated.model,
        Message.RequestedRoute({
          replace: false,
          route: CalendarRoute.make({}),
        })
      );

  return {
    commands: [
      ...(revealed
        ? [SavePreferences({ person, ...preferenceSnapshot(shown) })]
        : []),
      ...(navigated.commands ?? []),
      ...(routed.commands ?? []),
      ...(routed.model.calendar.navigation.mode === "month"
        ? []
        : [
            ScrollToSelection({
              allDay: event.allDay,
              hidden: timeGridGeometry(routed.model).grid.hidden,
              key: event.key,
              minute: event.startMinute,
              scale: timeGridGeometry(routed.model).scale,
            }),
          ]),
    ],
    model: {
      ...routed.model,
      calendar: { ...routed.model.calendar, selected: model.calendar.selected },
    },
  };
};

const beginOccurrence = (
  model: AppModel,
  direction: "next" | "previous"
): KeyboardResult => {
  const event = selectedRecurringReadEvent(model);
  const personId = Option.getOrUndefined(model.person);

  if (event === undefined || personId === undefined) {
    return { model };
  }

  const revision = model.selectionCommands.revision + 1;

  const task = OccurrenceTask.make({
    anchor: event.source,
    context: occurrenceContext(model),
    personId,
    request: {
      accountId: event.source.accountId,
      calendarId: event.source.calendarId,
      direction,
      eventId: event.source.eventId,
    },
    revision,
    selection: event.key,
  });

  return {
    model: {
      ...closeKeyboard(model),
      selectionCommands: {
        notice: Option.some(OccurrenceNotice.cases.Loading.make({ task })),
        revision,
        task: Option.some(task),
      },
    },
  };
};

const chooseColor = (model: AppModel, id: string): KeyboardResult => {
  const event = selectedColorEvent(model);
  const requested = id.slice("color:".length);

  if (
    event === undefined ||
    Option.isNone(model.person) ||
    (requested !== "calendar" &&
      !availableEventColors(model).some((color) => color.google === requested))
  ) {
    return { model };
  }

  const value = requested === "calendar" ? null : requested;

  const closed = closeKeyboard({
    ...model,
    keyboard: {
      ...model.keyboard,
      focus: value === null ? "event-color" : `event-color-${value}`,
      opening: "none",
    },
  });

  if (EditorView.guards.Editing(model.editing.view)) {
    return editAction(closed, EditorAction.cases.ColorSelected.make({ value }));
  }

  return editAction(
    {
      ...closed,
      keyboard: {
        ...closed.keyboard,
        focus: closed.keyboard.focus,
        opening: ColorOpening.make({
          event: eventKey(event.source),
          person: model.person.value,
          selection: event.key,
          value,
        }),
      },
    },
    EditorAction.cases.OpenEdit.make({})
  );
};

const ReadAction = Schema.Literals([
  "go-to-selection",
  "next-occurrence",
  "previous-occurrence",
  "open-in-provider",
]);

const selectedReadAction = (
  model: AppModel,
  id: typeof ReadAction.Type,
  apply: Apply
): KeyboardResult => {
  switch (id) {
    case "go-to-selection": {
      return goToSelection(model, apply);
    }

    case "next-occurrence": {
      return beginOccurrence(model, "next");
    }

    case "previous-occurrence": {
      return beginOccurrence(model, "previous");
    }

    case "open-in-provider": {
      const href = selectedProviderOriginal(model);

      return href === undefined
        ? { model }
        : {
            commands: [OpenProviderOriginal({ href })],
            model: closeKeyboard(model),
          };
    }

    default: {
      return { model };
    }
  }
};

export const keyboardAction = (
  model: AppModel,
  id: string,
  apply: Apply
): KeyboardResult => {
  if (Schema.is(SelectionKeyboardAction)(id)) {
    return selectionAction(model, id, apply);
  }

  if (id === "shortcuts") {
    return Predicate.isTagged(model.route, "Shortcuts")
      ? { commands: [FocusShortcutSearch()], model }
      : apply(
          closeKeyboard(model),
          Message.RequestedRoute({
            replace: false,
            route: ShortcutsRoute.make({ section: Option.none() }),
          })
        );
  }

  if (id.startsWith("color:")) {
    return chooseColor(model, id);
  }

  if (Schema.is(openingScreen)(id)) {
    return openScreen(model, id);
  }

  if (Schema.is(PanelAction)(id)) {
    return panelAction(model, id, apply);
  }

  if (id.startsWith("edit:")) {
    const focus = `event-${id.slice(5)}`;

    return editAction(
      {
        ...model,
        keyboard: {
          ...model.keyboard,
          focus,
          opening: focus === "event-allDay" ? "toggleAllDay" : "none",
        },
      },
      EditorAction.cases.OpenEdit.make({})
    );
  }

  if (Schema.is(ReadAction)(id)) {
    return selectedReadAction(model, id, apply);
  }

  switch (id) {
    case "join": {
      return apply(model, Message.RequestedJoinMeeting({ key: Option.none() }));
    }

    case "focus-shortcuts": {
      return { commands: [FocusShortcutSearch()], model };
    }

    case "open-event": {
      return openEvent(model, apply);
    }

    case "dismiss": {
      return dismiss(model, apply);
    }

    case "next": {
      return nextPeriod(model, 1, apply);
    }

    case "previous": {
      return nextPeriod(model, -1, apply);
    }

    case "align-today": {
      return apply(model, Message.ClickedAlignToday());
    }

    default: {
      return { model };
    }
  }
};

export const resetOpeningFocus = (
  model: AppModel,
  message: AppMessage
): AppModel =>
  Match.value(message).pipe(
    Match.tag("EditingAction", ({ action }) =>
      EditorAction.guards.OpenCreate(action) ||
      EditorAction.guards.OpenEdit(action) ||
      EditorAction.guards.DuplicateSelected(action)
        ? ({
            ...model,
            keyboard: {
              ...model.keyboard,
              focus: "event-title",
              opening: "none",
            },
          } satisfies AppModel)
        : model
    ),
    Match.orElse(() => model)
  );

export const pressedKeyboard = (
  model: AppModel,
  input: KeyboardInput,
  now: number,
  apply: Apply
): KeyboardResult => {
  const scope = EditorView.guards.Closed(model.editing.view)
    ? "grid"
    : "dialog";

  const { action, prefix, sequence } = resolveBinding(model, input, now, scope);

  const next = {
    ...model,
    keyboard: {
      ...model.keyboard,
      deadline: prefix ? sequence.deadline : 0,
      prefix: prefix ? sequence.prefix : "",
    },
  } satisfies AppModel;

  if (action === undefined) {
    return { model: next };
  }

  const message = action.dispatch(next);

  return apply(resetOpeningFocus(next, message), message);
};

export const pickKeyboard = (
  model: AppModel,
  id: string | undefined,
  apply: Apply
): KeyboardResult => {
  const choice =
    id === undefined
      ? enterChoice(model)
      : commandChoices(model).find(
          (entry) => entry.id === id && !entry.disabled
        );

  if (choice === undefined) {
    return { model };
  }

  const closed = closeKeyboard(model);

  return apply(resetOpeningFocus(closed, choice.message), choice.message);
};

export const keyboardHighlight = (
  model: AppModel,
  direction: -1 | 1
): AppModel => ({
  ...model,
  keyboard: { ...model.keyboard, highlighted: moveHighlight(model, direction) },
});

const finishColorOpening = (
  before: AppModel,
  after: AppModel,
  intent: typeof ColorOpening.Type
): KeyboardResult => {
  const cleared = {
    ...after,
    keyboard: {
      ...after.keyboard,
      focus:
        intent.value === null ? "event-color" : `event-color-${intent.value}`,
      opening: "none",
    },
  } satisfies AppModel;

  const event = selectedEvent(after);

  if (
    !Option.contains(after.person, intent.person) ||
    Option.exists(after.editing.owner, (owner) => owner !== intent.person) ||
    after.calendar.selected.length !== 1 ||
    after.calendar.selected[0] !== intent.selection ||
    event === undefined ||
    eventKey(event.source) !== intent.event ||
    !calendarWritable(after) ||
    (intent.value !== null &&
      !availableEventColors(after).some(
        (color) => color.google === intent.value
      ))
  ) {
    return { model: cleared };
  }

  if (EditorView.guards.Editing(after.editing.view)) {
    return selectedColorEvent(after) === undefined ||
      !Option.exists(
        after.editing.view.original,
        (original) => eventKey(original) === intent.event
      )
      ? { model: cleared }
      : editAction(
          cleared,
          EditorAction.cases.ColorSelected.make({ value: intent.value })
        );
  }

  return EditorView.guards.Loading(after.editing.view) ||
    (EditorView.guards.Closed(after.editing.view) &&
      EditorView.guards.Closed(before.editing.view))
    ? { model: after }
    : { model: cleared };
};

export const finishKeyboardOpening = (
  before: AppModel,
  after: AppModel
): KeyboardResult => {
  if (before.error !== after.error && Option.isSome(after.error)) {
    return {
      model: { ...after, keyboard: { ...after.keyboard, opening: "none" } },
    };
  }

  const intent = after.keyboard.opening;

  if (Schema.is(ColorOpening)(intent)) {
    return finishColorOpening(before, after, intent);
  }

  if (
    after.keyboard.opening !== "toggleAllDay" ||
    !EditorView.guards.Editing(after.editing.view) ||
    EditorView.guards.Editing(before.editing.view) ||
    !editableSelection(after)
  ) {
    return { model: after };
  }

  return editAction(
    { ...after, keyboard: { ...after.keyboard, opening: "none" } },
    EditorAction.cases.ToggleAllDay.make({})
  );
};
