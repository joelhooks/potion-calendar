import { statusEventType } from "@calendar/calendar/contracts";
import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";

import { eventPalette } from "../../layout/colors.js";
import { ordinaryLink } from "../../layout/event-links.js";
import { visibleEvents } from "../../layout/presentation.js";
import type { DisplayEvent } from "../../layout/presentation.js";
import { SettingsRoute } from "../../layout/route.js";
import { primarySelection } from "../../layout/selection-set.js";
import { persistentZoneLimit } from "../../layout/time-zones.js";
import type { AppModel } from "../app.js";
import { BulkView } from "../bulk/model.js";
import { eventKey } from "../calendar-state.js";
import { DesktopRequest } from "../desktop/model.js";
import { commandTypeChoices } from "../editing/create-type-choices.js";
import { EditorAction } from "../editing/editor-action.js";
import { currentConversion, EditorView } from "../editing/editor-model.js";
import {
  instantDeleteEligible,
  instantSaveEligible,
} from "../editing/instant.js";
import { writableCalendar } from "../editing/load-editor.js";
import { selectedParticipantEmail } from "../email-participants.js";
import { icsExportAvailable } from "../ics-export/selection.js";
import { JoinSelection } from "../meetings/model.js";
import { joinSelection } from "../meetings/selection.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import { SettingsChange } from "../settings/model.js";
import { TimeZoneAction, ZoneChooser } from "../time-zones/model.js";
import { formatKey } from "./hints.js";

export type Availability = "enabled" | "disabled" | "hidden" | "shortcut-only";

export type Scope = "app" | "grid" | "dialog" | "text";

export type ShortcutSection =
  | "General"
  | "Workflows"
  | "Editing"
  | "Calendar view"
  | "Calendar navigation"
  | "App navigation";

export type CommandSection =
  | "Event"
  | "Calendar"
  | "Navigation"
  | "Time zones"
  | "App"
  | "Calendars"
  | "View"
  | "Settings & help"
  | "Accounts"
  | "Search";

export interface KeyboardAction {
  readonly id: string;
  readonly title: string;
  readonly keys: readonly string[];
  readonly scope: Scope;
  readonly section: ShortcutSection;
  readonly commandSection: CommandSection;
  readonly keywords: readonly {
    readonly text: string;
    readonly weight: number;
  }[];
  readonly exact?: string;
  readonly menu?: boolean;
  readonly availability: (model: AppModel) => Availability;
  readonly dispatch: (model: AppModel) => AppMessage;
}

interface EventProjection {
  readonly editing: AppModel["editing"];
  readonly events: readonly DisplayEvent[];
  readonly searchResponse: AppModel["search"]["response"];
  readonly session: AppModel["session"];
  readonly upcomingData: AppModel["upcoming"]["data"];
}

const eventProjection = new WeakMap<AppModel["calendar"], EventProjection>();

export const keyboardEvents = (model: AppModel): readonly DisplayEvent[] => {
  const cached = eventProjection.get(model.calendar);

  if (
    cached?.editing === model.editing &&
    cached.session === model.session &&
    cached.searchResponse === model.search.response &&
    cached.upcomingData === model.upcoming.data
  ) {
    return cached.events;
  }

  const events = visibleEvents(model);
  eventProjection.set(model.calendar, {
    editing: model.editing,
    events,
    searchResponse: model.search.response,
    session: model.session,
    upcomingData: model.upcoming.data,
  });

  return events;
};

export const selectedEvent = (model: AppModel): DisplayEvent | undefined =>
  keyboardEvents(model).find((item) =>
    Option.contains(primarySelection(model.calendar.selected), item.key)
  );

const active = (model: AppModel): Availability =>
  Option.isSome(model.person) && EditorView.guards.Closed(model.editing.view)
    ? "enabled"
    : "disabled";

const selected = (model: AppModel): Availability =>
  selectedEvent(model) === undefined ? "hidden" : active(model);

export const selectedReadEvent = (
  model: AppModel
): DisplayEvent | undefined => {
  if (active(model) !== "enabled" || model.calendar.selected.length !== 1) {
    return undefined;
  }

  return (
    selectedEvent(model) ??
    selectedEvent({
      ...model,
      calendar: { ...model.calendar, hidden: [] },
    })
  );
};

export const selectedNavigationEvent = (
  model: AppModel
): DisplayEvent | undefined => {
  if (active(model) !== "enabled" || model.calendar.selected.length === 0) {
    return undefined;
  }

  const keys = new Set(model.calendar.selected);

  return keyboardEvents({
    ...model,
    calendar: { ...model.calendar, hidden: [] },
  })
    .filter((event) => keys.has(event.key))
    .toSorted(
      (left, right) =>
        left.startDay - right.startDay ||
        left.startMinute - right.startMinute ||
        left.key.localeCompare(right.key)
    )[0];
};

export const selectedRecurringReadEvent = (
  model: AppModel
): DisplayEvent | undefined => {
  const event = selectedReadEvent(model);

  return event?.source.recurringEventId !== undefined &&
    event.source.recurringEventId !== ""
    ? event
    : undefined;
};

export const selectedProviderOriginal = (
  model: AppModel
): string | undefined => {
  const link = selectedReadEvent(model)?.source.htmlLink;
  const href = link === undefined ? undefined : ordinaryLink(link);

  return href?.startsWith("http:") === true ||
    href?.startsWith("https:") === true
    ? href
    : undefined;
};

export const calendarWritable = (model: AppModel): boolean => {
  const event = selectedEvent(model)?.source;

  return (
    event !== undefined &&
    model.calendar.calendars.some(
      (calendar) =>
        calendar.accountId === event.accountId &&
        calendar.calendarId === event.calendarId &&
        writableCalendar(calendar)
    )
  );
};

export const selectedColorEvent = (
  model: AppModel
): DisplayEvent | undefined => {
  const event = selectedEvent(model);
  const { view } = model.editing;

  if (
    Option.isNone(model.person) ||
    BulkView.guards.Running(model.editing.bulk) ||
    BulkView.guards.Undoing(model.editing.bulk) ||
    model.calendar.selected.length !== 1 ||
    event === undefined ||
    !calendarWritable(model)
  ) {
    return undefined;
  }

  return EditorView.guards.Closed(view) ||
    (EditorView.guards.Editing(view) &&
      Option.contains(model.editing.owner, model.person.value) &&
      view.kind === "edit" &&
      view.operation === "save" &&
      view.permissions.calendarWritable &&
      Option.exists(
        view.original,
        (original) => eventKey(original) === eventKey(event.source)
      ))
    ? event
    : undefined;
};

export const availableEventColors = (model: AppModel) => {
  const event = selectedEvent(model);
  const index = AsyncData.getData(model.calendar.index);

  const account = Option.isSome(index)
    ? index.value.accounts.find(
        (entry) => entry.accountId === event?.source.accountId
      )
    : undefined;

  if (
    event === undefined ||
    account === undefined ||
    !("calendars" in account) ||
    !account.calendars.some(
      (calendar) => calendar.calendarId === event.source.calendarId
    )
  ) {
    return [];
  }

  return eventPalette.filter(
    (color) =>
      color.google !== "" && Object.hasOwn(account.colors.event, color.google)
  );
};

export const editableSelection = (model: AppModel): boolean => {
  const event = selectedEvent(model)?.source;

  return (
    calendarWritable(model) &&
    (event?.organizer?.self === true || event?.guestsCanModify === true)
  );
};

const selectedAvailability = (
  model: AppModel,
  permitted: boolean
): Availability => {
  if (selected(model) === "hidden") {
    return "hidden";
  }

  return permitted ? active(model) : "disabled";
};

const edit = (model: AppModel): Availability =>
  selectedAvailability(model, editableSelection(model));

const personal = (model: AppModel): Availability =>
  selectedAvailability(model, calendarWritable(model));

const ordinaryField = (model: AppModel): Availability =>
  statusEventType(selectedEvent(model)?.source.eventType)
    ? selectedAvailability(model, false)
    : edit(model);

const rsvp = (model: AppModel): Availability => {
  const event = selectedEvent(model)?.source;

  return selectedAvailability(
    model,
    calendarWritable(model) &&
      !statusEventType(event?.eventType) &&
      event?.attendees?.some(
        (person) => person.self === true && person.organizer !== true
      ) === true
  );
};

const special = (id: string) => () => Message.KeyboardAction({ id });

const editing = (action: typeof EditorAction.Type) => (model: AppModel) =>
  Message.EditingAction({
    action,
    personId: Option.getOrUndefined(model.person),
  });

const row = (
  id: string,
  title: string,
  keys: readonly string[],
  section: ShortcutSection,
  commandSection: CommandSection,
  dispatch: KeyboardAction["dispatch"],
  options: Partial<
    Omit<
      KeyboardAction,
      "id" | "title" | "keys" | "section" | "commandSection" | "dispatch"
    >
  > = {}
): KeyboardAction => ({
  availability: active,
  commandSection,
  dispatch,
  id,
  keys,
  keywords: [],
  scope: "grid",
  section,
  title,
  ...options,
});

const field = (
  key: string,
  title: string,
  focus: string,
  availability = edit
) =>
  row(
    `edit-${focus}`,
    title,
    [`e ${key}`],
    "Editing",
    "Event",
    special(`edit:${focus}`),
    { availability }
  );

const joinAvailability = (model: AppModel): Availability => {
  const availability = active(model);

  if (availability !== "enabled") {
    return availability;
  }

  return JoinSelection.guards.Available(joinSelection(model))
    ? "enabled"
    : "shortcut-only";
};

export const keyboardRegistry: readonly KeyboardAction[] = [
  row(
    "event-type",
    "Change event type",
    [],
    "Editing",
    "Event",
    special("event-type"),
    {
      availability: (model) =>
        commandTypeChoices(model.editing, model.calendar.calendars).length > 0
          ? "enabled"
          : "hidden",
      scope: "dialog",
    }
  ),
  row(
    "go-to-selection",
    "Go to selection",
    [],
    "Calendar navigation",
    "Event",
    special("go-to-selection"),
    {
      availability: (model) =>
        selectedNavigationEvent(model) === undefined ? "hidden" : "enabled",
    }
  ),
  row(
    "open-in-provider",
    "Open in Google Calendar",
    [],
    "Workflows",
    "Event",
    special("open-in-provider"),
    {
      availability: (model) =>
        selectedProviderOriginal(model) === undefined ? "hidden" : "enabled",
    }
  ),
  ...["next", "previous"].map((direction) =>
    row(
      `${direction}-occurrence`,
      direction === "next" ? "Next occurrence" : "Previous occurrence",
      [],
      "Calendar navigation",
      "Event",
      special(`${direction}-occurrence`),
      {
        availability: (model) =>
          selectedRecurringReadEvent(model) === undefined
            ? "hidden"
            : "enabled",
      }
    )
  ),
  row(
    "export-ics",
    "Export as .ics",
    [],
    "Workflows",
    "Event",
    () => Message.RequestedIcsExport(),
    {
      availability: (model) =>
        icsExportAvailable(model) ? "enabled" : "hidden",
    }
  ),
  row(
    "email-participants",
    "Email participants",
    ["e e"],
    "Workflows",
    "Event",
    () => Message.RequestedEmailParticipants(),
    {
      availability: (model) =>
        active(model) === "enabled" &&
        selectedParticipantEmail(model).kind === "ready"
          ? "enabled"
          : "disabled",
    }
  ),
  row(
    "join",
    "Join meeting",
    ["Mod+j"],
    "Workflows",
    "Event",
    () => Message.RequestedJoinMeeting({ key: Option.none() }),
    { availability: joinAvailability }
  ),
  row(
    "open-editor",
    "Edit event",
    ["Enter"],
    "Editing",
    "Event",
    editing(EditorAction.cases.OpenEdit.make({})),
    { availability: selected }
  ),
  row(
    "merge-events",
    "Merge duplicate events",
    [],
    "Calendar view",
    "View",
    () => Message.ClickedMergeDuplicates()
  ),
  row(
    "add-account",
    "Add Google account",
    [],
    "App navigation",
    "Accounts",
    () => Message.ClickedAddGoogle()
  ),
  row(
    "manage-accounts",
    "Manage calendar accounts",
    [],
    "App navigation",
    "Accounts",
    () =>
      Message.RequestedRoute({
        replace: false,
        route: SettingsRoute.make({ page: "calendars" }),
      })
  ),
  row("sign-out", "Log out", [], "App navigation", "Accounts", () =>
    Message.ClickedSignOut()
  ),
  row(
    "commands",
    "Command menu",
    ["Mod+k"],
    "General",
    "App",
    special("commands"),
    { menu: false, scope: "app" }
  ),
  row(
    "desktop-menu-bar",
    "Show/hide menu-bar calendar",
    [],
    "App navigation",
    "App",
    (model) =>
      Option.match(AsyncData.getData(model.desktop.settings), {
        onNone: () => Message.KeyboardClose(),
        onSome: ({ preferences }) =>
          Message.RequestedDesktop({
            request: DesktopRequest.cases.Save.make({
              preferences: { ...preferences, menuBar: !preferences.menuBar },
              request: model.desktop.request + 1,
            }),
          }),
      }),
    {
      availability: (model) => {
        if (model.desktop.availability !== "available") {
          return "hidden";
        }

        if (
          Option.isNone(AsyncData.getData(model.desktop.settings)) ||
          AsyncData.isLoading(model.desktop.settings) ||
          AsyncData.isRefreshing(model.desktop.settings)
        ) {
          return "disabled";
        }

        return active(model);
      },
      scope: "app",
    }
  ),
  row(
    "sidebar",
    "Show/hide sidebar",
    ["`", "Mod+\\"],
    "General",
    "App",
    special("sidebar"),
    { keywords: [{ text: "calendar sidebar", weight: 0.8 }], scope: "app" }
  ),
  row(
    "context",
    "Show/hide event context panel",
    ["\\"],
    "General",
    "App",
    special("context"),
    { scope: "app" }
  ),
  row(
    "sidebars",
    "Show/hide all sidebars",
    ["Shift+Mod+\\"],
    "General",
    "App",
    special("sidebars"),
    { scope: "app" }
  ),
  row(
    "confirm",
    "Save or confirm",
    ["Enter", "Mod+Enter"],
    "General",
    "Event",
    editing(EditorAction.cases.Save.make({})),
    {
      availability: (model) =>
        EditorView.guards.Editing(model.editing.view) ? "enabled" : "disabled",
      menu: false,
      scope: "dialog",
    }
  ),
  row(
    "dismiss",
    "Dismiss or go back",
    ["Escape"],
    "General",
    "App",
    (model) =>
      Option.isSome(model.timeZones.temporary) &&
      model.keyboard.screen === "closed" &&
      EditorView.guards.Closed(model.editing.view)
        ? Message.TimeZoneAction({ action: TimeZoneAction.cases.Home.make({}) })
        : Message.KeyboardAction({ id: "dismiss" }),
    {
      availability: (model) =>
        Option.isSome(model.timeZones.temporary) ||
        Option.isSome(primarySelection(model.calendar.selected)) ||
        Predicate.isTagged(model.route, "Shortcuts") ||
        Predicate.isTagged(model.route, "Settings") ||
        model.keyboard.screen !== "closed" ||
        !EditorView.guards.Closed(model.editing.view)
          ? "enabled"
          : "disabled",
      menu: false,
      scope: "app",
    }
  ),
  row(
    "focus-shortcuts",
    "Search keyboard shortcuts",
    ["Mod+f"],
    "General",
    "App",
    special("focus-shortcuts"),
    {
      availability: (model) =>
        Predicate.isTagged(model.route, "Shortcuts") ? active(model) : "hidden",
      menu: false,
      scope: "app",
    }
  ),
  row(
    "search-events",
    "Search events",
    ["/", "Mod+f"],
    "Workflows",
    "Navigation",
    () => Message.SearchOpened({ query: Option.none() }),
    {
      availability: (model) =>
        Predicate.isTagged(model.route, "Shortcuts") ? "hidden" : active(model),
      keywords: [{ text: "find events", weight: 0.8 }],
      scope: "app",
    }
  ),
  row(
    "refresh",
    "Refresh calendars",
    ["r", "Control+r"],
    "General",
    "Calendar",
    () => Message.ClickedRefresh()
  ),
  row("undo", "Undo", ["Mod+z"], "General", "Event", special("undo"), {
    availability: (model) =>
      currentConversion(model.editing.view) !== undefined ||
      model.editing.deletes.some((mark) => mark.phase === "pending")
        ? "enabled"
        : "disabled",
    scope: "app",
  }),
  row(
    "select-all",
    "Select visible events",
    ["Mod+a"],
    "Editing",
    "Event",
    special("select-all"),
    {
      availability: (model) =>
        Predicate.isTagged(model.route, "Calendar")
          ? active(model)
          : "disabled",
    }
  ),
  row(
    "toggle-selection",
    "Select/deselect highlighted event",
    ["x"],
    "General",
    "View",
    special("toggle-selection"),
    {
      availability: (model) =>
        Option.isSome(primarySelection(model.calendar.selected)) ||
        Option.isSome(model.keyboard.cursor)
          ? active(model)
          : "disabled",
    }
  ),
  row(
    "delete-instantly",
    "Delete instantly",
    ["Mod+Delete", "Mod+Backspace", "Mod+Del"],
    "Editing",
    "Event",
    editing(EditorAction.cases.DeleteInstantly.make({})),
    {
      availability: (model) =>
        selectedAvailability(model, instantDeleteEligible(model)),
    }
  ),
  row(
    "delete-no-email",
    "Delete occurrence without email",
    ["Shift+Mod+Delete", "Shift+Mod+Backspace", "Shift+Mod+Del"],
    "Editing",
    "Event",
    editing(EditorAction.cases.DeleteNoEmail.make({})),
    {
      availability: (model) =>
        selectedAvailability(model, instantDeleteEligible(model)),
    }
  ),
  row(
    "save-no-email",
    "Save occurrence without email",
    ["Shift+Mod+Enter"],
    "Editing",
    "Event",
    editing(EditorAction.cases.SaveNoEmail.make({})),
    {
      availability: (model) =>
        Option.isSome(model.person) && instantSaveEligible(model)
          ? "enabled"
          : "disabled",
      scope: "app",
    }
  ),
  row(
    "delete",
    "Delete",
    ["Delete", "Backspace"],
    "General",
    "Event",
    editing(EditorAction.cases.DeleteSelected.make({})),
    {
      availability: (model) =>
        model.calendar.selected.length > 1 ? active(model) : personal(model),
    }
  ),
  row(
    "duplicate",
    "Duplicate",
    ["Mod+d"],
    "General",
    "Event",
    editing(EditorAction.cases.DuplicateSelected.make({})),
    {
      availability: (model) =>
        selectedAvailability(
          model,
          model.calendar.calendars.some(writableCalendar)
        ),
    }
  ),
  row(
    "create",
    "Create event",
    ["c"],
    "Workflows",
    "Calendar",
    editing(EditorAction.cases.OpenCreate.make({})),
    {
      availability: (model) =>
        model.calendar.calendars.some(writableCalendar)
          ? active(model)
          : "hidden",
      keywords: [{ text: "new meeting", weight: 0.8 }],
    }
  ),
  row(
    "next-selection",
    "Select next",
    ["n"],
    "Workflows",
    "View",
    special("next-selection"),
    {
      availability: (model) =>
        keyboardEvents(model).length > 0 ? active(model) : "disabled",
    }
  ),
  row(
    "previous-selection",
    "Select previous",
    ["b", "Shift+n"],
    "Workflows",
    "View",
    special("previous-selection"),
    {
      availability: (model) =>
        keyboardEvents(model).length > 0 ? active(model) : "disabled",
    }
  ),
  field("t", "Edit title", "title"),
  field("d", "Edit day", "startDate"),
  field("z", "Edit time zone", "timeZone", (model) => {
    const start = selectedEvent(model)?.source.start;

    return start !== undefined && "date" in start ? "disabled" : edit(model);
  }),
  field("s", "Edit start time", "startTime", (model) =>
    selectedEvent(model)?.allDay === true ? "disabled" : edit(model)
  ),
  field("q", "Edit end time", "endTime", (model) =>
    selectedEvent(model)?.allDay === true ? "disabled" : edit(model)
  ),
  field("j", "Edit conferencing", "add-meet", (model) => {
    const event = selectedEvent(model)?.source;

    const calendar = model.calendar.calendars.find(
      (value) =>
        value.accountId === event?.accountId &&
        value.calendarId === event.calendarId
    );

    return (event?.eventType === undefined || event.eventType === "default") &&
      calendar?.allowedConferenceSolutionTypes?.includes("hangoutsMeet") ===
        true
      ? edit(model)
      : selectedAvailability(model, false);
  }),
  field("c", "Edit calendar / color", "calendar", personal),
  row("colors", "Change color", [], "Editing", "Event", special("colors"), {
    availability: (model) =>
      selectedColorEvent(model) === undefined ? "disabled" : "enabled",
    keywords: [{ text: "colour calendar provider", weight: 0.8 }],
  }),
  field("a", "Toggle all-day", "allDay", ordinaryField),
  field("r", "Edit repeat pattern", "repeat"),
  field("p", "Edit participants", "participantEmail", (model) =>
    selectedEvent(model)?.source.attendeesOmitted === true ||
    selectedEvent(model)?.source.eventType === "focusTime"
      ? "disabled"
      : ordinaryField(model)
  ),
  field("l", "Edit location", "location", ordinaryField),
  field("w", "Edit description", "description", ordinaryField),
  field("k", "Open links and attachments", "links", (model) =>
    statusEventType(selectedEvent(model)?.source.eventType)
      ? "disabled"
      : personal(model)
  ),
  field("h", "Edit reminders", "reminderInput", personal),
  row(
    "rsvp-yes",
    "Respond yes",
    ["e y"],
    "Editing",
    "Event",
    editing(EditorAction.cases.Rsvp.make({ response: "accepted" })),
    { availability: rsvp }
  ),
  row(
    "rsvp-no",
    "Respond no",
    ["e n"],
    "Editing",
    "Event",
    editing(EditorAction.cases.Rsvp.make({ response: "declined" })),
    { availability: rsvp }
  ),
  row(
    "rsvp-maybe",
    "Respond maybe",
    ["e m"],
    "Editing",
    "Event",
    editing(EditorAction.cases.Rsvp.make({ response: "tentative" })),
    { availability: rsvp }
  ),
  row("day", "Day view", ["1", "d"], "Calendar view", "View", () =>
    Message.ClickedView({ days: 1, mode: "day" })
  ),
  ...Array.from({ length: 8 }, (_, index) =>
    row(
      `days-${index + 2}`,
      `Display ${index + 2} days`,
      [String(index + 2)],
      "Calendar view",
      "View",
      () => Message.ClickedView({ days: index + 2, mode: "days" }),
      { exact: String(index + 2) }
    )
  ),
  row("week", "Week view", ["0", "w"], "Calendar view", "View", () =>
    Message.ClickedView({ days: 7, mode: "week" })
  ),
  row("month", "Month view", ["m"], "Calendar view", "View", () =>
    Message.ClickedView({ days: 7, mode: "month" })
  ),
  row(
    "display-days",
    "Set number of displayed days",
    [],
    "Calendar view",
    "View",
    special("days")
  ),
  row(
    "weekdays",
    "Hide/unhide weekdays",
    [],
    "Calendar view",
    "View",
    special("weekdays")
  ),
  row(
    "weekends",
    "Show/hide weekends",
    ["Shift+Mod+e"],
    "Calendar view",
    "View",
    () => Message.ClickedWeekends()
  ),
  row(
    "week-numbers",
    "Show/hide week numbers",
    [],
    "Calendar view",
    "View",
    (model) =>
      Message.ChangedSettings({
        change: SettingsChange.cases.WeekNumbers.make({
          shown: !model.settings.showWeekNumbers,
        }),
      })
  ),
  row(
    "declined",
    "Show/hide declined events",
    ["Shift+Mod+d"],
    "Calendar view",
    "View",
    () => Message.ClickedDeclined()
  ),
  row(
    "all-day",
    "Expand/collapse all-day section",
    ["Shift+Mod+a"],
    "Calendar view",
    "View",
    () => Message.ClickedAllDay()
  ),
  row(
    "zoom-reset",
    "Default hour size",
    ["Shift+Mod+0"],
    "Calendar view",
    "View",
    () => Message.ClickedZoom({ step: 0 })
  ),
  row(
    "zoom-in",
    "Zoom hours in",
    ["Shift+Mod+."],
    "Calendar view",
    "View",
    () => Message.ClickedZoom({ step: 1 })
  ),
  row(
    "zoom-out",
    "Zoom hours out",
    ["Shift+Mod+,"],
    "Calendar view",
    "View",
    () => Message.ClickedZoom({ step: -1 })
  ),
  row(
    "go-date",
    "Go to date",
    ["."],
    "Calendar navigation",
    "Navigation",
    special("date"),
    { keywords: [{ text: "jump date", weight: 0.9 }] }
  ),
  row(
    "today",
    "Go to today",
    ["t"],
    "Calendar navigation",
    "Navigation",
    (model) =>
      model.settings.todayAction === "today"
        ? Message.ClickedToday()
        : Message.KeyboardAction({ id: "align-today" })
  ),
  row(
    "align-today",
    "Align today in view",
    ["Alt+t"],
    "Calendar navigation",
    "Navigation",
    (model) =>
      model.settings.todayAction === "align"
        ? Message.ClickedToday()
        : Message.KeyboardAction({ id: "align-today" })
  ),
  row(
    "next",
    "Next week / month",
    ["j"],
    "Calendar navigation",
    "Navigation",
    special("next")
  ),
  row(
    "previous",
    "Previous week / month",
    ["k"],
    "Calendar navigation",
    "Navigation",
    special("previous")
  ),
  row(
    "right",
    "Move view right",
    ["ArrowRight"],
    "Calendar navigation",
    "Navigation",
    () => Message.ClickedPage({ direction: 1 })
  ),
  row(
    "left",
    "Move view left",
    ["ArrowLeft"],
    "Calendar navigation",
    "Navigation",
    () => Message.ClickedPage({ direction: -1 })
  ),
  row(
    "up",
    "Move view up",
    ["ArrowUp"],
    "Calendar navigation",
    "Navigation",
    () => Message.ClickedPage({ direction: -1 }),
    {
      availability: (model) =>
        model.calendar.navigation.mode === "month" ? active(model) : "disabled",
    }
  ),
  row(
    "down",
    "Move view down",
    ["ArrowDown"],
    "Calendar navigation",
    "Navigation",
    () => Message.ClickedPage({ direction: 1 }),
    {
      availability: (model) =>
        model.calendar.navigation.mode === "month" ? active(model) : "disabled",
    }
  ),
  row(
    "travel-zone",
    "Travel temporarily",
    ["z"],
    "Calendar navigation",
    "Time zones",
    () =>
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Open.make({
          chooser: ZoneChooser.cases.Travel.make({}),
        }),
      })
  ),
  row(
    "home-zone",
    "Return home",
    [],
    "Calendar navigation",
    "Time zones",
    () =>
      Message.TimeZoneAction({ action: TimeZoneAction.cases.Home.make({}) }),
    {
      availability: (model) =>
        Option.isSome(model.timeZones.temporary) ? active(model) : "hidden",
    }
  ),
  row(
    "add-zone",
    "Add secondary time zone",
    [],
    "Calendar view",
    "Time zones",
    () =>
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Open.make({
          chooser: ZoneChooser.cases.Add.make({}),
        }),
      }),
    {
      availability: (model) =>
        model.timeZones.preferences.secondary.length < persistentZoneLimit - 1
          ? active(model)
          : "hidden",
    }
  ),
  row(
    "hide-zone",
    "Hide time zone",
    [],
    "Calendar view",
    "Time zones",
    () =>
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Open.make({
          chooser: ZoneChooser.cases.Hide.make({}),
        }),
      }),
    {
      availability: (model) =>
        model.timeZones.preferences.secondary.length > 0
          ? active(model)
          : "hidden",
    }
  ),
  row(
    "primary-zone",
    "Make primary time zone",
    [],
    "Calendar view",
    "Time zones",
    () =>
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Open.make({
          chooser: ZoneChooser.cases.Primary.make({}),
        }),
      }),
    {
      availability: (model) =>
        model.timeZones.preferences.secondary.length > 0 ||
        Option.isSome(model.timeZones.temporary)
          ? active(model)
          : "hidden",
    }
  ),
  row(
    "rename-zone",
    "Rename time zone",
    [],
    "Calendar view",
    "Time zones",
    () =>
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Open.make({
          chooser: ZoneChooser.cases.Rename.make({}),
        }),
      })
  ),
  row(
    "zone-left",
    "Move time zone left",
    [],
    "Calendar view",
    "Time zones",
    () =>
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Open.make({
          chooser: ZoneChooser.cases.Move.make({ direction: -1 }),
        }),
      }),
    {
      availability: (model) =>
        model.timeZones.preferences.secondary.length > 1
          ? active(model)
          : "hidden",
    }
  ),
  row(
    "zone-right",
    "Move time zone right",
    [],
    "Calendar view",
    "Time zones",
    () =>
      Message.TimeZoneAction({
        action: TimeZoneAction.cases.Open.make({
          chooser: ZoneChooser.cases.Move.make({ direction: 1 }),
        }),
      }),
    {
      availability: (model) =>
        model.timeZones.preferences.secondary.length > 1
          ? active(model)
          : "hidden",
    }
  ),
  row(
    "settings",
    "Settings",
    ["g s"],
    "App navigation",
    "Settings & help",
    () =>
      Message.RequestedRoute({
        replace: false,
        route: SettingsRoute.make({ page: "general" }),
      }),
    { scope: "app" }
  ),
  row(
    "cycle-theme",
    "Cycle theme",
    ["Shift+Mod+l"],
    "General",
    "Settings & help",
    () => Message.CycledTheme(),
    { menu: false, scope: "app" }
  ),
  row("theme", "Theme", [], "General", "Settings & help", special("theme"), {
    keywords: [{ text: "appearance auto light dark", weight: 0.8 }],
    scope: "app",
  }),
  row(
    "week-start",
    "Start week on",
    [],
    "Calendar view",
    "View",
    special("week-start"),
    {
      keywords: [{ text: "week start sunday monday", weight: 0.8 }],
    }
  ),
  row(
    "shortcuts",
    "Keyboard shortcuts",
    ["?"],
    "App navigation",
    "Settings & help",
    special("shortcuts"),
    { keywords: [{ text: "keys help", weight: 0.8 }], scope: "app" }
  ),
];

export const sequencePrefixes = (): readonly string[] => [
  ...new Set(
    keyboardRegistry.flatMap((action) =>
      action.keys.flatMap((binding) =>
        binding.includes(" ") ? [binding.split(" ")[0] ?? ""] : []
      )
    )
  ),
];

export const actionCatalog = (model: AppModel): readonly KeyboardAction[] => [
  ...keyboardRegistry,
  ...model.calendar.calendars.map((calendar) =>
    row(
      `calendar:${calendar.accountId}:${calendar.calendarId}`,
      `Show/hide ${calendar.title}`,
      [],
      "Calendar view",
      "Calendars",
      () =>
        Message.ClickedCalendar({
          accountId: calendar.accountId,
          calendarId: calendar.calendarId,
        })
    )
  ),
];

export const keyHints = (
  action: KeyboardAction,
  platform = navigator.platform
): readonly string[] => action.keys.map((key) => formatKey(key, platform));

export const bindingHints = (
  id: string,
  platform = navigator.platform
): readonly string[] => {
  const action = keyboardRegistry.find((item) => item.id === id);

  return action === undefined ? [] : keyHints(action, platform);
};
