import { Option, Match, Predicate, Schema } from "effect";
import type { Update } from "foldkit";

import { dayInZone, visibleDays } from "../../layout/navigation.js";
import { visibleEvents } from "../../layout/presentation.js";
import { CalendarRoute, ShortcutsRoute } from "../../layout/route.js";
import {
  primarySelection,
  changeSelection,
  SelectionAction,
} from "../../layout/selection-set.js";
import type { AppModel } from "../app.js";
import { bulkSummary } from "../bulk/selection.js";
import type { ClipboardRuntime } from "../clipboard/runtime.js";
import { EditorAction } from "../editing/editor-action.js";
import { EditorView } from "../editing/editor-model.js";
import type { EditingRuntime } from "../editing/runtime.js";
import { editAction } from "../editing/update.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import type { MonthRuntime } from "../month/runtime.js";
import type { CalendarSearchClient } from "../search/client.js";
import { selectionRangeDays } from "../selection/range.js";
import { FocusShortcutSearch } from "./browser.js";
import { commandChoices, enterChoice, moveHighlight } from "./choices.js";
import { resolveBinding } from "./input.js";
import type { KeyboardInput } from "./input.js";
import { PanelAction, panelAction } from "./panels.js";
import {
  calendarWritable,
  editableSelection,
  selectedEvent,
} from "./registry.js";

export type KeyboardResult = Update.Return<
  AppModel,
  AppMessage,
  EditingRuntime | CalendarSearchClient | ClipboardRuntime | MonthRuntime
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
  screen: "commands" | "days" | "date" | "event-zone"
): KeyboardResult => ({
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
});

const openingScreen = Schema.Literals([
  "commands",
  "days",
  "date",
  "event-zone",
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
      const today = dayInZone(model.calendar.now, model.calendar.zone);
      const count = visibleDays(model.calendar.navigation).length;

      const days = apply(
        model,
        Message.ClickedView({ days: Math.max(1, count), mode: "days" })
      );

      return apply(days.model, Message.KeyboardDate({ day: today }));
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

export const finishKeyboardOpening = (
  before: AppModel,
  after: AppModel
): KeyboardResult => {
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
