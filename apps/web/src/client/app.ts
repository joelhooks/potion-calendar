import type { CalendarRefValue } from "@calendar/calendar/contracts";
import { SessionSnapshot } from "@calendar/core/contracts";
import { MeetingJoinOutcome } from "@calendar/core/desktop-bridge";
import { DateTime, Match, Option, Predicate, Schema } from "effect";
import { AsyncData } from "foldkit";
import type { Runtime, Update } from "foldkit";
import type { UrlRequest } from "foldkit/navigation";
import type { Url } from "foldkit/url";

import { packAllDay } from "../layout/all-day.js";
import { minuteInZone } from "../layout/geometry.js";
import { monthWindowRange } from "../layout/month-window.js";
import {
  dayInZone,
  initialNavigation,
  midnightInZone,
  visibleDays,
} from "../layout/navigation.js";
import type { NavigationAction } from "../layout/navigation.js";
import { allDaySection, visibleEvents } from "../layout/presentation.js";
import { CalendarRoute, Route, SettingsRoute } from "../layout/route.js";
import {
  primarySelection,
  changeSelection,
  SelectionAction,
} from "../layout/selection-set.js";
import {
  AttachmentReads,
  initialAttachmentReads,
} from "./attachments/model.js";
import {
  receiveEventAttachments,
  withEventAttachmentReads,
} from "./attachments/update.js";
import { BulkView } from "./bulk/model.js";
import {
  CalendarUi,
  RemoteCalendars,
  RemoteEvents,
  calendarKey,
} from "./calendar-state.js";
import {
  DispatchClipboard,
  DispatchClipboardCut,
  DispatchClipboardGroupCut,
} from "./clipboard/commands.js";
import { receiveClipboardDelivery } from "./clipboard/delivery.js";
import { clipboardCutEvents } from "./clipboard/host.js";
import { ClipboardReceipt } from "./clipboard/machine.js";
import {
  ClipboardUi,
  initialClipboard,
  resetClipboardScope,
} from "./clipboard/model.js";
import type { ClipboardRuntime } from "./clipboard/runtime.js";
import {
  BeginGoogle,
  PreserveTimePosition,
  ReadCalendars,
  ReadEvents,
  ReadPreferences,
  ReadSession,
  SavePreferences,
  ScrollToNow,
  SignOut,
} from "./commands.js";
import {
  ConferencingState,
  initialConferencing,
  clearConferencing,
} from "./conferencing/model.js";
import {
  changeConferencing,
  loadConferencingAccounts,
} from "./conferencing/update.js";
import { ApplyDesktopRequest } from "./desktop/commands.js";
import {
  DesktopNotice,
  DesktopRequest,
  DesktopUi,
  initialDesktop,
} from "./desktop/model.js";
import { desktopSelection } from "./desktop/selection.js";
import { beginDesktopRequest, receiveDesktopNotice } from "./desktop/update.js";
import { EditorView } from "./editing/editor-model.js";
import { acceptsGesture } from "./editing/gesture-targets.js";
import type { EditingRuntime } from "./editing/runtime.js";
import { EditingUi } from "./editing/ui-model.js";
import {
  editAction,
  completeGesture,
  leaveEditing,
  receiveEditing,
  reconcileEditingRead,
  mutationReceived,
  bulkControl,
} from "./editing/update.js";
import { emailParticipants } from "./email-participants.js";
import { resumeTimeGrid } from "./grid-resume/update.js";
import { KeyboardUi, initialKeyboard } from "./keyboard/state.js";
import {
  closeKeyboard,
  finishKeyboardOpening,
  keyboardAction,
  keyboardHighlight,
  pickKeyboard,
  pressedKeyboard,
  resetOpeningFocus,
} from "./keyboard/update.js";
import { LiveNotice } from "./live/protocol.js";
import { RefreshEvents } from "./live/refresh.js";
import { noticeAffectsSelection } from "./live/socket.js";
import { JoinMeeting } from "./meetings/commands.js";
import { joinSelection } from "./meetings/selection.js";
import { Message } from "./message.js";
import type { AppMessage } from "./message.js";
import { monthFrame, monthHostKey } from "./month/host.js";
import { MonthUi, initialMonthUi } from "./month/model.js";
import type { MonthRuntime } from "./month/runtime.js";
import {
  receiveMonthNotice,
  retainedMonthSources,
  settleMonthRead,
} from "./month/update.js";
import { navigationTransition, preserveMonthDisplay } from "./navigation.js";
import { actOnReminderCard } from "./reminders/actions.js";
import { withReminders } from "./reminders/integration.js";
import { initialReminderState } from "./reminders/machine.js";
import { NotificationEvent, ReminderState } from "./reminders/model.js";
import { selectReminderNotification } from "./reminders/selection.js";
import {
  completeReminderDelivery,
  completeReminderPermission,
  observeReminder,
  requestReminders,
} from "./reminders/update.js";
import {
  BackRoute,
  FollowRouteRequest,
  InitializeRouteHistory,
  NavigateRoute,
  ScrollShortcutSection,
  routeFromUrl,
} from "./routing.js";
import type { CalendarSearchClient } from "./search/client.js";
import { BlurSearch } from "./search/commands.js";
import { SearchUi, initialSearch } from "./search/model.js";
import {
  blurSearch,
  clearSearch,
  receiveSearch,
  refreshSearch,
  searchInput,
  searchOpen,
  selectSearchResult,
  syncSearchRoute,
} from "./search/update.js";
import { acceptsSelection, selectionHostKey } from "./selection/host.js";
import {
  manageSettings,
  receiveManagedInventory,
} from "./settings-management/app.js";
import { ManageSettings } from "./settings-management/commands.js";
import {
  SettingsManagement,
  initialSettingsManagement,
} from "./settings-management/model.js";
import {
  ConferencingSettings,
  initialConferencingSettings,
} from "./settings/conferencing/model.js";
import { updateConferencingSettings } from "./settings/conferencing/update.js";
import {
  SettingsUi,
  SettingsChange,
  initialSettings,
} from "./settings/model.js";
import {
  applyPreferences,
  changeSettings,
  preferenceSnapshot,
} from "./settings/update.js";
import { VisibilityMigration } from "./settings/visibility-model.js";
import { chooseVisibility } from "./settings/visibility.js";
import { timeGridGeometry } from "./time-blocks/grid.js";
import { initialTimeBlockEditor } from "./time-blocks/model.js";
import { changeTimeBlocks } from "./time-blocks/update.js";
import {
  TimeZonesUi,
  TimeZoneAction,
  activeZone,
  homeZone,
  initialTimeZones,
} from "./time-zones/model.js";
import { changeTimeZones } from "./time-zones/update.js";
import { Upcoming, initialUpcoming } from "./upcoming/model.js";
import {
  failUpcoming,
  receiveUpcoming,
  withUpcoming,
} from "./upcoming/update.js";

export { Message } from "./message.js";

export type { AppMessage } from "./message.js";

export const onUrlChange = (url: Url) => Message.BrowserUrlChanged({ url });

export const onUrlRequest = (request: UrlRequest) =>
  Message.BrowserUrlRequested({ request });

const scrollForRoute = (route: typeof Route.Type) =>
  Predicate.isTagged(route, "Shortcuts") && Option.isSome(route.section)
    ? [ScrollShortcutSection({ section: route.section.value })]
    : [];

export const RemoteSession = AsyncData.Schema(SessionSnapshot, Schema.String);

export const Model = Schema.Struct({
  action: Schema.Literals(["idle", "pending"]),
  attachmentReads: AttachmentReads,
  calendar: CalendarUi,
  clipboard: ClipboardUi,
  conferencing: ConferencingState,
  conferencingSettings: ConferencingSettings,
  desktop: DesktopUi,
  editing: EditingUi,
  error: Schema.Option(Schema.String),
  keyboard: KeyboardUi,
  month: MonthUi,
  person: Schema.Option(Schema.String),
  reminders: ReminderState,
  route: Route,
  search: SearchUi,
  session: RemoteSession.schema,
  settings: SettingsUi,
  settingsManagement: SettingsManagement,
  timeZones: TimeZonesUi,
  upcoming: Upcoming,
});

export type AppModel = typeof Model.Type;

type Result = Update.Return<
  AppModel,
  AppMessage,
  EditingRuntime | CalendarSearchClient | ClipboardRuntime | MonthRuntime
>;

export const initialModel = (now: number, zone: string): AppModel => ({
  action: "idle",
  attachmentReads: initialAttachmentReads,
  calendar: {
    allDayExpanded: true,
    allDayRows: {},
    calendars: [],
    hidden: [],
    hideDeclined: false,
    index: RemoteCalendars.Idle(),
    mergeDuplicates: true,
    navigation: initialNavigation(dayInZone(now, zone)),
    now,
    previousTimePeriod: Option.none(),
    rangeRequest: 0,
    reads: [],
    rectangle: Option.none(),
    scrollbarGutter: 0,
    selected: [],
    viewport: 700,
    viewportWidth: 1000,
    visibility: {},
    visibilityMigration: VisibilityMigration.cases.Current.make({}),
    zone,
    zoom: 0,
  },
  clipboard: initialClipboard,
  conferencing: initialConferencing(),
  conferencingSettings: initialConferencingSettings(),
  desktop: initialDesktop(),
  editing: {
    bulk: BulkView.cases.Idle.make({}),
    bulkOutcomes: {},
    conferencingResult: Option.none(),
    deletes: [],
    gesture: Option.none(),
    gestureRefusal: Option.none(),
    handledBulk: Option.none(),
    handledMutation: Option.none(),
    handledRecovery: Option.none(),
    handledResponse: 0,
    instantSaved: Option.none(),
    owner: Option.none(),
    response: Option.none(),
    rsvp: {
      focused: Option.none(),
      note: "",
      result: Option.none(),
      saving: Option.none(),
    },
    view: EditorView.cases.Closed.make({}),
    write: Option.none(),
  },
  error: Option.none(),
  keyboard: initialKeyboard(),
  month: initialMonthUi(),
  person: Option.none(),
  reminders: initialReminderState(),
  route: CalendarRoute.make({}),
  search: initialSearch(),
  session: RemoteSession.Loading(),
  settings: initialSettings(),
  settingsManagement: initialSettingsManagement(),
  timeZones: initialTimeZones(zone),
  upcoming: initialUpcoming(),
});

const readCalendarsFor = (model: AppModel) =>
  Option.match(model.person, {
    onNone: () => [],
    onSome: (personId) => [ReadCalendars({ personId })],
  });

const persistPreferences = (result: Result): Result => {
  const { model } = result;

  return Option.isNone(model.person)
    ? result
    : {
        ...result,
        commands: [
          ...(result.commands ?? []),
          SavePreferences({
            ...preferenceSnapshot(model),
            person: model.person.value,
          }),
        ],
      };
};

export const init: Runtime.ApplicationInit<AppModel, AppMessage> = () => ({
  commands: [
    ReadSession(),
    ApplyDesktopRequest({
      request: DesktopRequest.cases.Read.make({ request: 0 }),
    }),
  ],
  model: initialModel(
    DateTime.toEpochMillis(DateTime.nowUnsafe()),
    Intl.DateTimeFormat().resolvedOptions().timeZone
  ),
});

export const initWithRoute: Runtime.RoutingApplicationInit<
  AppModel,
  AppMessage
> = (url) => ({
  commands: [
    InitializeRouteHistory(),
    ReadSession(),
    ApplyDesktopRequest({
      request: DesktopRequest.cases.Read.make({ request: 0 }),
    }),
  ],
  model: {
    ...initialModel(
      DateTime.toEpochMillis(DateTime.nowUnsafe()),
      Intl.DateTimeFormat().resolvedOptions().timeZone
    ),
    route: routeFromUrl(url),
  },
});

export const reloadRange = (
  model: AppModel,
  sync = false,
  reconcile: readonly CalendarRefValue[] = [],
  previous: AppModel = model
): Result => {
  const days = visibleDays(model.calendar.navigation);

  const monthRange =
    model.calendar.navigation.mode === "month"
      ? (model.month.pending.pipe(
          Option.filter((pending) =>
            Option.contains(monthHostKey(model), pending.session.hostKey)
          ),
          Option.map((pending) => pending.request.range),
          Option.getOrUndefined
        ) ?? monthWindowRange(monthFrame(model).firstWeek))
      : undefined;

  const first =
    monthRange === undefined
      ? days.at(0)
      : initialNavigation(monthRange.start).anchor;

  const last =
    monthRange === undefined
      ? days.at(-1)
      : initialNavigation(monthRange.end - 1).anchor;

  if (first === undefined || last === undefined) {
    return { model };
  }

  const previousDays = visibleDays(previous.calendar.navigation);
  const [previousFirst] = previousDays;
  const previousLast = previousDays.at(-1);

  const overlapping =
    previous.calendar.zone === model.calendar.zone &&
    previousFirst !== undefined &&
    previousLast !== undefined &&
    previousFirst <= last &&
    first <= previousLast;

  const request = model.calendar.rangeRequest + 1;

  const calendars = model.calendar.calendars.filter(
    (item) =>
      !model.calendar.hidden.includes(
        calendarKey(item.accountId, item.calendarId)
      ) ||
      reconcile.some(
        (ref) =>
          ref.accountId === item.accountId && ref.calendarId === item.calendarId
      )
  );

  const accounts = [...new Set(calendars.map((item) => item.accountId))];

  const range = {
    end: midnightInZone(last + 1, model.calendar.zone),
    start: midnightInZone(first, model.calendar.zone),
  };

  return {
    commands: accounts.map((accountId) =>
      (sync ? RefreshEvents : ReadEvents)({
        accountId,
        calendars: calendars
          .filter((item) => item.accountId === accountId)
          .map(({ calendarId }) => ({ accountId, calendarId })),
        range,
        request,
      })
    ),
    model: {
      ...model,
      calendar: {
        ...model.calendar,
        rangeRequest: request,
        reads: accounts.map((accountId) => {
          const saved =
            overlapping || monthRange !== undefined
              ? model.calendar.reads.find(
                  (read) => read.accountId === accountId
                )
              : undefined;

          const data =
            saved === undefined
              ? Option.none()
              : AsyncData.getData(saved.events);

          return {
            accountId,
            events: Option.match(data, {
              onNone: () => RemoteEvents.Loading(),
              onSome: (savedData) =>
                saved !== undefined && AsyncData.isStale(saved.events)
                  ? saved.events
                  : RemoteEvents.Refreshing({ data: savedData }),
            }),
          };
        }),
      },
      month:
        monthRange === undefined
          ? model.month
          : {
              ...model.month,
              range: Option.some(monthRange),
              rangeHost: monthHostKey(model),
            },
    },
  };
};

const changeNavigation = (
  model: AppModel,
  action: NavigationAction,
  previous: AppModel = model
): Result => {
  const result = reloadRange(
    navigationTransition(model, action),
    false,
    [],
    previous
  );

  if (
    (action.type === "today" || action.type === "align") &&
    result.model.calendar.navigation.mode !== "month"
  ) {
    const { grid, scale } = timeGridGeometry(result.model);

    return {
      ...result,
      commands: [
        ...(result.commands ?? []),
        ScrollToNow({
          hidden: grid.hidden,
          minute: minuteInZone(model.calendar.now, model.calendar.zone),
          scale,
        }),
      ],
    };
  }

  return result;
};

const receivedEventRows = (model: AppModel): AppModel => {
  const spans = visibleEvents(model)
    .filter((item) => item.allDay)
    .map((item) => ({ end: item.endDay, id: item.key, start: item.startDay }));

  const packed = packAllDay(
    spans,
    new Map(Object.entries(model.calendar.allDayRows))
  );

  return {
    ...model,
    calendar: {
      ...model.calendar,
      allDayRows: Object.fromEntries(packed.map((item) => [item.id, item.row])),
    },
  };
};

const toggleAllDay = (model: AppModel): Result => {
  const allDayExpanded = !model.calendar.allDayExpanded;

  const offset =
    allDaySection(model, allDayExpanded).height - allDaySection(model).height;

  return {
    commands: [PreserveTimePosition({ offset })],
    model: { ...model, calendar: { ...model.calendar, allDayExpanded } },
  };
};

const updateCore = (
  model: AppModel,
  message: AppMessage,
  dispatch: (model: AppModel, message: AppMessage) => Result
): Result =>
  Message.match<Result>(message, {
    BrowserUrlChanged: ({ url }) => {
      const route = routeFromUrl(url);
      const closed = closeKeyboard(model);

      return {
        commands: scrollForRoute(route),
        model: syncSearchRoute(
          {
            ...closed,
            keyboard: {
              ...closed.keyboard,
              query:
                Predicate.isTagged(route, "Shortcuts") &&
                Predicate.isTagged(model.route, "Shortcuts")
                  ? model.keyboard.query
                  : "",
            },
          },
          route
        ),
      };
    },
    BrowserUrlRequested: ({ request }) => ({
      commands: [FollowRouteRequest({ request })],
      model,
    }),
    BulkControl: ({ control, personId }) =>
      personId === undefined || Option.contains(model.person, personId)
        ? bulkControl(model, control)
        : { model },
    CalendarChanged: () => reloadRange(model),
    ChangedConferencing: ({ change }) => changeConferencing(model, change),
    ChangedConferencingSettings: ({ change, personId }) =>
      updateConferencingSettings(model, personId, change),
    ChangedSettings: ({ change }) => {
      const next = preserveMonthDisplay(model, changeSettings(model, change));

      const datesChanged =
        JSON.stringify(visibleDays(next.calendar.navigation)) !==
        JSON.stringify(visibleDays(model.calendar.navigation));

      return persistPreferences(
        datesChanged || SettingsChange.guards.WeekStart(change)
          ? reloadRange(next, false, [], model)
          : { model: receivedEventRows(next) }
      );
    },
    ChangedSettingsManagement: ({ change }) => {
      const next = manageSettings(model, change);

      return {
        commands: [
          ...(next.task === undefined
            ? []
            : [ManageSettings({ task: next.task })]),
          ...(next.refresh || next.removed ? readCalendarsFor(next.model) : []),
        ],
        model: next.model,
      };
    },
    ChangedTimeBlocks: ({ action, personId }) => {
      if (
        !Option.contains(model.person, personId) ||
        !Predicate.isTagged(model.route, "Settings") ||
        model.route.page !== "general"
      ) {
        return { model };
      }

      const next = changeTimeBlocks(model, action);

      return next.changed
        ? persistPreferences({ model: next.model })
        : { model: next.model };
    },
    ClickedAddGoogle: () => ({
      commands: [BeginGoogle({ linking: true })],
      model: { ...model, action: "pending", error: Option.none() },
    }),
    ClickedAlignToday: () => changeNavigation(model, { type: "align" }),
    ClickedAllDay: () => toggleAllDay(model),
    ClickedCalendar: ({ accountId, calendarId }) => {
      if (
        !model.calendar.calendars.some(
          (calendar) =>
            calendar.accountId === accountId &&
            calendar.calendarId === calendarId
        )
      ) {
        return { model };
      }

      const key = calendarKey(accountId, calendarId);

      const visibility = chooseVisibility(
        model.calendar.calendars,
        model.calendar.visibility,
        model.calendar.visibilityMigration,
        { accountId, calendarId },
        model.calendar.hidden.includes(key)
      );

      const result = reloadRange({
        ...model,
        calendar: { ...model.calendar, ...visibility, selected: [] },
      });

      return persistPreferences(result);
    },
    ClickedDate: ({ day }) =>
      changeNavigation(
        model.calendar.navigation.mode === "month"
          ? {
              ...model,
              calendar: {
                ...model.calendar,
                navigation: { ...model.calendar.navigation, mode: "day" },
              },
            }
          : model,
        { day, type: "date" },
        model
      ),
    ClickedDeclined: () =>
      persistPreferences({
        model: receivedEventRows({
          ...model,
          calendar: {
            ...model.calendar,
            hideDeclined: !model.calendar.hideDeclined,
          },
        }),
      }),
    ClickedEnableReminders: () => requestReminders(model),
    ClickedEvent: ({ key }) => ({
      model: {
        ...model,
        calendar: { ...model.calendar, selected: [key] },
        keyboard: { ...model.keyboard, cursor: Option.some(key) },
      },
    }),
    ClickedMergeDuplicates: () => {
      const mergeDuplicates = !model.calendar.mergeDuplicates;

      return persistPreferences({
        model: receivedEventRows({
          ...model,
          calendar: {
            ...model.calendar,
            mergeDuplicates,
            selected: [],
          },
        }),
      });
    },
    ClickedPage: ({ direction }) =>
      changeNavigation(model, { direction, type: "page" }),
    ClickedRefresh: () => reloadRange(model, true),
    ClickedRetry: () => ({
      commands: readCalendarsFor(model),
      model: {
        ...model,
        calendar: {
          ...model.calendar,
          index: Option.getOrElse(
            AsyncData.revalidateOrLoad(model.calendar.index),
            () => model.calendar.index
          ),
        },
      },
    }),
    ClickedSignIn: () => ({
      commands: [BeginGoogle({ linking: false })],
      model: { ...model, action: "pending", error: Option.none() },
    }),
    ClickedSignOut: () => ({
      commands: [SignOut()],
      model: { ...model, action: "pending", error: Option.none() },
    }),
    ClickedToday: () => changeNavigation(model, { type: "today" }),
    ClickedView: ({ mode, days }) =>
      changeNavigation(model, { days, mode, type: "view" }),
    ClickedWeekends: () =>
      dispatch(
        model,
        Message.ChangedSettings({
          change: SettingsChange.cases.Weekends.make({
            shown: model.calendar.navigation.hideWeekends,
          }),
        })
      ),
    ClickedZoom: ({ step }) => ({
      model: {
        ...model,
        calendar: {
          ...model.calendar,
          zoom:
            step === 0
              ? 0
              : Math.max(-4, Math.min(20, model.calendar.zoom + step)),
        },
      },
    }),
    ClipboardAction: ({ action, personId, sessionId }) =>
      Option.contains(model.person, personId) &&
      Option.contains(model.clipboard.sessionId, sessionId)
        ? {
            commands: [DispatchClipboard({ action, personId, sessionId })],
            model,
          }
        : { model },
    ClosedDetail: () => ({
      model: {
        ...model,
        calendar: { ...model.calendar, selected: [] },
      },
    }),
    CompletedGesture: ({ personId, gesture, hostKey }) =>
      acceptsGesture(model, personId, hostKey)
        ? completeGesture(
            { ...model, editing: { ...model.editing, gesture: Option.none() } },
            gesture
          )
        : { model },
    CompletedGridScroll: () => ({ model }),
    CompletedMonthRead: () => ({ model }),
    CycledTheme: () => {
      const themes: Record<
        typeof SettingsUi.Type.theme,
        typeof SettingsUi.Type.theme
      > = { auto: "light", dark: "auto", light: "dark" };

      return persistPreferences({
        model: {
          ...model,
          settings: { ...model.settings, theme: themes[model.settings.theme] },
        },
      });
    },
    DismissedGestureRefusal: ({ personId }) => ({
      model: Option.contains(model.person, personId)
        ? {
            ...model,
            editing: { ...model.editing, gestureRefusal: Option.none() },
          }
        : model,
    }),
    DispatchedClipboard: () => ({ model }),
    DispatchedEditing: () => ({ model }),
    EditingAction: ({ action, personId }) =>
      personId !== undefined && !Option.contains(model.person, personId)
        ? { model }
        : editAction(resetOpeningFocus(model, message), action),
    FailedAuth: () => ({
      model: {
        ...model,
        action: "idle",
        error: Option.some("The account request failed. Please try again."),
      },
    }),
    FailedCalendars: ({ failure, personId }) => {
      if (personId !== undefined && !Option.contains(model.person, personId)) {
        return { model };
      }

      return {
        model: {
          ...model,
          calendar: {
            ...model.calendar,
            index: Option.match(AsyncData.getData(model.calendar.index), {
              onNone: () => RemoteCalendars.Failure({ error: failure }),
              onSome: (data) => RemoteCalendars.Stale({ data, error: failure }),
            }),
          },
        },
      };
    },
    FailedClipboard: ({ message: failureMessage, personId, sessionId }) =>
      Option.contains(model.person, personId) &&
      Option.contains(model.clipboard.sessionId, sessionId)
        ? { model: { ...model, error: Option.some(failureMessage) } }
        : { model },
    FailedEditing: ({ message: failureMessage }) =>
      finishKeyboardOpening(model, {
        ...model,
        error: Option.some(failureMessage),
      }),
    FailedEvents: ({ accountId, failure, request }) =>
      request === model.calendar.rangeRequest
        ? settleMonthRead({
            ...model,
            calendar: {
              ...model.calendar,
              reads: model.calendar.reads.map((item) =>
                item.accountId === accountId
                  ? {
                      ...item,
                      events: Option.match(AsyncData.getData(item.events), {
                        onNone: () => RemoteEvents.Failure({ error: failure }),
                        onSome: (data) =>
                          RemoteEvents.Stale({ data, error: failure }),
                      }),
                    }
                  : item
              ),
            },
          })
        : { model },
    FailedPreferenceSave: ({ person }) =>
      Option.contains(model.person, person)
        ? {
            model: {
              ...model,
              error: Option.some("Settings could not be saved on this device."),
            },
          }
        : { model },
    FailedPreferences: ({ person }) =>
      Option.contains(model.person, person)
        ? {
            commands: readCalendarsFor(model),
            model: {
              ...model,
              calendar: { ...model.calendar, index: RemoteCalendars.Loading() },
              error: Option.some(
                "Saved settings could not be read. This view uses defaults."
              ),
            },
          }
        : { model },
    FailedSession: () => ({
      model: {
        ...model,
        session: RemoteSession.Failure({
          error: "Could not load your session. Reload to try again.",
        }),
      },
    }),
    FailedUpcoming: (result) => ({ model: failUpcoming(model, result) }),
    FinishedJoinMeeting: ({ outcome, personId }) =>
      Option.getOrUndefined(model.person) === personId
        ? {
            model: {
              ...model,
              error: MeetingJoinOutcome.match(outcome, {
                Failed: ({ message: failureMessage }) =>
                  Option.some(failureMessage),
                NoMeeting: ({ reason }) =>
                  Option.some(
                    reason === "noUpcoming"
                      ? "No upcoming meeting to join"
                      : "Selected event has no conferencing"
                  ),
                Requested: () => Option.none(),
              }),
            },
          }
        : { model },
    KeyboardAction: ({ id }) => keyboardAction(model, id, dispatch),
    KeyboardClose: () =>
      Predicate.isTagged(model.route, "Shortcuts") &&
      model.keyboard.screen === "closed"
        ? { commands: [BackRoute()], model: closeKeyboard(model) }
        : { model: closeKeyboard(model) },
    KeyboardDate: ({ day, flash }) =>
      changeNavigation(
        flash === true
          ? {
              ...model,
              keyboard: {
                ...model.keyboard,
                flash: Option.some(day),
                flashVersion: model.keyboard.flashVersion + 1,
              },
            }
          : model,
        { day, type: "date" }
      ),
    KeyboardHighlight: ({ id }) => ({
      model: { ...model, keyboard: { ...model.keyboard, highlighted: id } },
    }),
    KeyboardMove: ({ direction }) => ({
      model: keyboardHighlight(model, direction),
    }),
    KeyboardPick: ({ id }) => pickKeyboard(model, id, dispatch),
    KeyboardQuery: ({ query }) => ({
      model: {
        ...model,
        keyboard: { ...model.keyboard, highlighted: "", query },
      },
    }),
    KeyboardResetSequence: () => ({
      model: {
        ...model,
        keyboard: { ...model.keyboard, deadline: 0, prefix: "" },
      },
    }),
    KeyboardReturn: () => pickKeyboard(model, undefined, dispatch),
    MeasuredViewport: ({ gutter, height, width }) => ({
      model: {
        ...model,
        calendar: {
          ...model.calendar,
          scrollbarGutter: gutter,
          viewport: height,
          viewportWidth: width,
        },
      },
    }),
    ModifiedEventSelection: ({ personId, hostKey, key, mod, shift }) =>
      acceptsSelection(model, personId, hostKey)
        ? {
            model: {
              ...model,
              calendar: {
                ...model.calendar,
                selected: changeSelection(
                  model.calendar.selected,
                  SelectionAction.cases.Click.make({ key, mod, shift })
                ),
              },
              keyboard: { ...model.keyboard, cursor: Option.some(key) },
            },
          }
        : { model },
    Navigated: () => ({ model }),
    ObservedNotification: ({ event, now }) => {
      if (!NotificationEvent.guards.Clicked(event)) {
        return observeReminder(model, event, now);
      }

      return event.notification.card === undefined
        ? selectReminderNotification(model, event.notification, dispatch)
        : { model };
    },
    PageHidden: () => leaveEditing(model),
    PreparedGestureHost: () => ({ model }),
    PreparedGestureTargets: () => ({ model }),
    PreparedSelection: () => ({ model }),
    PressedCalendarKey: ({ key, mod, shift, alt, now }) =>
      pressedKeyboard(
        model,
        { alt, key, mod, shift },
        now ?? model.calendar.now,
        dispatch
      ),
    PreviewedGesture: ({ personId, preview, hostKey }) =>
      acceptsGesture(model, personId, hostKey)
        ? {
            model: {
              ...model,
              editing: { ...model.editing, gesture: preview },
            },
          }
        : { model },
    PreviewedSelectionRectangle: ({ personId, hostKey, box }) =>
      acceptsSelection(model, personId, hostKey)
        ? {
            model: {
              ...model,
              calendar: { ...model.calendar, rectangle: box },
            },
          }
        : { model },
    ReceivedCalendars: ({ result, personId }) => {
      if (personId !== undefined && !Option.contains(model.person, personId)) {
        return { model };
      }

      const accepted = receiveManagedInventory(model, result);

      const accounts =
        Option.getOrUndefined(AsyncData.getData(accepted.model.session))
          ?.accounts ?? [];

      const preferences = loadConferencingAccounts(
        accepted.model,
        accounts
          .filter((account) => !account.disconnected)
          .map((account) => account.id),
        false
      );

      const range = reloadRange(preferences.model, false, [], model);

      const refreshed = {
        ...range,
        commands: [...(range.commands ?? []), ...(preferences.commands ?? [])],
      };

      return accepted.migrationCompleted
        ? persistPreferences(refreshed)
        : refreshed;
    },
    ReceivedClipboard: ({ delivery }) => {
      const received = receiveClipboardDelivery(
        model.clipboard,
        model.person,
        delivery
      );

      const next = { ...model, clipboard: received.state };

      if (Option.isNone(received.receipt)) {
        return { model: next };
      }

      return ClipboardReceipt.match<Result>(received.receipt.value, {
        Created: ({ mutation }) => {
          const saved = mutationReceived(next, mutation);

          return saved.reload
            ? reloadRange(
                refreshSearch(saved.model),
                false,
                saved.reconcile,
                model
              )
            : { model: saved.model };
        },
        CreatedGroup: ({ mutations }) => {
          let saved = next;

          for (const mutation of mutations) {
            saved = mutationReceived(saved, mutation).model;
          }

          return mutations.length === 0
            ? { model: next }
            : reloadRange(refreshSearch(saved), false, undefined, model);
        },
        Cut: ({ source }) => ({
          commands: [
            DispatchClipboardCut({
              input: {
                calendars: next.calendar.calendars,
                events: clipboardCutEvents(next),
                navigation: next.calendar.navigation,
                primaryZone: homeZone(next),
                selection: primarySelection(next.calendar.selected),
                source,
              },
              personId: delivery.personId,
              sessionId: delivery.sessionId,
            }),
          ],
          model: next,
        }),
        CutGroup: ({ selection, sources }) => ({
          commands: [
            DispatchClipboardGroupCut({
              input: {
                calendars: next.calendar.calendars,
                events: clipboardCutEvents(next),
                navigation: next.calendar.navigation,
                primaryZone: homeZone(next),
                selection,
                sources,
              },
              personId: delivery.personId,
              sessionId: delivery.sessionId,
            }),
          ],
          model: next,
        }),
      });
    },
    ReceivedDesktop: ({ notice }) => {
      if (!DesktopNotice.guards.Action(notice)) {
        return {
          model: {
            ...model,
            desktop: receiveDesktopNotice(model.desktop, notice),
          },
        };
      }

      return Match.value(notice.action).pipe(
        Match.tagsExhaustive({
          OpenSettings: ({ page }) =>
            dispatch(
              model,
              Message.RequestedRoute({
                replace: false,
                route: SettingsRoute.make({ page }),
              })
            ),
          RequestedJoinMeeting: () =>
            dispatch(
              model,
              Message.RequestedJoinMeeting({ key: Option.none() })
            ),
          ShowEvent: ({ key }) => {
            const selected = desktopSelection(model, key);

            if (selected === undefined) {
              return {
                model: {
                  ...model,
                  error: Option.some("This event is no longer available."),
                },
              };
            }

            const route = CalendarRoute.make({});

            const result = changeNavigation(
              { ...model, route },
              { day: selected.startDay, type: "date" }
            );

            return {
              ...result,
              commands: [
                ...(result.commands ?? []),
                NavigateRoute({ replace: false, route }),
              ],
              model: {
                ...result.model,
                calendar: {
                  ...result.model.calendar,
                  selected: [selected.key],
                },
              },
            };
          },
        })
      );
    },
    ReceivedEditing: ({ notice, personId }) => {
      const next = receiveEditing(model, personId, notice);

      return next.reload
        ? reloadRange(refreshSearch(next.model), false, next.reconcile, model)
        : finishKeyboardOpening(model, next.model);
    },
    ReceivedEventAttachments: ({ result }) =>
      receiveEventAttachments(model, result),
    ReceivedEvents: ({ accountId, request, result }) =>
      request === model.calendar.rangeRequest
        ? settleMonthRead(
            receivedEventRows(
              reconcileEditingRead(
                {
                  ...model,
                  calendar: {
                    ...model.calendar,
                    reads: model.calendar.reads.map((item) =>
                      item.accountId === accountId
                        ? {
                            ...item,
                            events: RemoteEvents.Success({
                              data: {
                                ...result,
                                events: retainedMonthSources(
                                  model,
                                  Option.match(AsyncData.getData(item.events), {
                                    onNone: () => [],
                                    onSome: (data) => data.events,
                                  }),
                                  result.events
                                ),
                              },
                            }),
                          }
                        : item
                    ),
                  },
                },
                accountId,
                request
              )
            )
          )
        : { model },
    ReceivedLive: ({ notice, personId }) => {
      if (!Option.contains(model.person, personId)) {
        return { model };
      }

      const selected = model.calendar.calendars.filter(
        (calendar) =>
          !model.calendar.hidden.includes(
            calendarKey(calendar.accountId, calendar.calendarId)
          )
      );

      const refreshed = refreshSearch(model);

      if (!noticeAffectsSelection(notice, selected)) {
        return { model: refreshed };
      }

      return LiveNotice.guards.CalendarChanged(notice)
        ? reloadRange(refreshed)
        : { commands: readCalendarsFor(refreshed), model: refreshed };
    },
    ReceivedMonth: ({ notice }) =>
      receiveMonthNotice(model, notice, reloadRange),
    ReceivedPreferences: ({ person, preferences }) => {
      if (!Option.contains(model.person, person)) {
        return { model };
      }

      const applied = applyPreferences(model, preferences);

      const result: Result = {
        commands: readCalendarsFor(applied),
        model: {
          ...applied,
          calendar: {
            ...applied.calendar,
            index: Option.match(AsyncData.getData(applied.calendar.index), {
              onNone: () => RemoteCalendars.Loading(),
              onSome: (data) => RemoteCalendars.Refreshing({ data }),
            }),
          },
        },
      };

      return preferences.visibilityMigration !== undefined ||
        preferences.zones === undefined ||
        preferences.zones.lastSystemZone !==
          applied.timeZones.preferences.lastSystemZone
        ? persistPreferences(result)
        : result;
    },
    ReceivedSearch: ({ notice }) => receiveSearch(model, notice),
    ReceivedSession: ({ snapshot }) => {
      const initial = initialModel(model.calendar.now, model.timeZones.system);

      const cleared = {
        ...initial,
        calendar: {
          ...initial.calendar,
          rangeRequest: model.calendar.rangeRequest,
        },
        conferencing: clearConferencing(model.conferencing),
        conferencingSettings: initialConferencingSettings(
          model.conferencingSettings.requestId + 1
        ),
        desktop: {
          availability: model.desktop.availability,
          error: Option.none(),
          request: model.desktop.request,
          settings: model.desktop.settings,
        },
        route: model.route,
        search: initialSearch(model.search.revision + 1),
        session: RemoteSession.Success({ data: snapshot }),
        settings: {
          ...initialSettings(),
          system24Hour: model.settings.system24Hour,
          systemDark: model.settings.systemDark,
        },
        settingsManagement:
          snapshot !== null && Option.contains(model.person, snapshot.user.id)
            ? model.settingsManagement
            : initialSettingsManagement(model.settingsManagement.sequence + 1),
      };

      if (snapshot === null) {
        return { model: cleared };
      }

      const preferences = loadConferencingAccounts(
        syncSearchRoute(
          { ...cleared, person: Option.some(snapshot.user.id) },
          model.route
        ),
        snapshot.accounts
          .filter((account) => !account.disconnected)
          .map((account) => account.id),
        false
      );

      return {
        commands: [
          ReadPreferences({ person: snapshot.user.id }),
          ...scrollForRoute(model.route),
          ...(preferences.commands ?? []),
        ],
        model: preferences.model,
      };
    },
    ReceivedSystemSettings: ({ dark, hour24 }) => ({
      model: {
        ...model,
        settings: { ...model.settings, system24Hour: hour24, systemDark: dark },
      },
    }),
    ReceivedUpcoming: (result) => ({ model: receiveUpcoming(model, result) }),
    RefusedGesture: ({ personId, hostKey, reason }) => ({
      model: acceptsGesture(model, personId, hostKey)
        ? {
            ...model,
            editing: { ...model.editing, gestureRefusal: Option.some(reason) },
          }
        : model,
    }),
    ReminderCardAction: ({ action, id, personId }) =>
      actOnReminderCard(model, personId, id, action, dispatch),
    ReminderDeliveryCompleted: (result) =>
      completeReminderDelivery(model, result),
    ReminderEffectCompleted: () => ({ model }),
    ReminderPermissionCompleted: (result) =>
      completeReminderPermission(model, result),
    RequestedDesktop: ({ request }) => {
      const desktop = beginDesktopRequest(model.desktop);

      const current = Match.value(request).pipe(
        Match.tagsExhaustive({
          Read: () =>
            DesktopRequest.cases.Read.make({ request: desktop.request }),
          Save: ({ preferences }) =>
            DesktopRequest.cases.Save.make({
              preferences,
              request: desktop.request,
            }),
          Startup: ({ enabled }) =>
            DesktopRequest.cases.Startup.make({
              enabled,
              request: desktop.request,
            }),
        })
      );

      return {
        commands: [ApplyDesktopRequest({ request: current })],
        model: { ...model, desktop },
      };
    },
    RequestedEmailParticipants: () => emailParticipants(model),
    RequestedJoinMeeting: ({ key }) =>
      Option.match(model.person, {
        onNone: () => ({ model }),
        onSome: (personId) => ({
          commands: [
            JoinMeeting({
              personId,
              selection: joinSelection(model, Option.getOrUndefined(key)),
            }),
          ],
          model: { ...model, error: Option.none() },
        }),
      }),
    RequestedRoute: ({ route, replace }) => ({
      commands: [NavigateRoute({ replace, route })],
      model: syncSearchRoute(closeKeyboard(model), route),
    }),
    RequestedRouteBack: () => ({
      commands: [BackRoute()],
      model: closeKeyboard(model),
    }),
    ResumedFromBackground: ({ now }) => resumeTimeGrid(model, now),
    SavedPreferences: () => ({ model }),
    SearchBlur: () => blurSearch(model),
    SearchClear: () => clearSearch(model),
    SearchContext: ({ key }) => ({
      model: {
        ...model,
        search: { ...model.search, menu: Option.some({ key }) },
      },
    }),
    SearchContextClose: () => ({
      model: Option.isNone(model.search.menu)
        ? model
        : { ...model, search: { ...model.search, menu: Option.none() } },
    }),
    SearchEscape: () => ({ commands: [BlurSearch()], model }),
    SearchInput: ({ text }) => searchInput(model, text),
    SearchOpened: ({ query }) => searchOpen(model, query),
    SearchPrefetchFailed: ({ personId, revision, problem }) => ({
      model:
        Option.contains(model.person, personId) &&
        revision === model.search.revision &&
        Predicate.isTagged(model.route, "Search")
          ? {
              ...model,
              search: { ...model.search, problem: Option.some(problem) },
            }
          : model,
    }),
    SearchScroll: ({ position }) => ({
      model: {
        ...model,
        search: { ...model.search, scroll: Option.some(position) },
      },
    }),
    SearchSelect: ({ key, goTo }) => {
      const selected = selectSearchResult(model, key, goTo);

      if (!selected.reload) {
        return { commands: selected.commands ?? [], model: selected.model };
      }

      const loaded = reloadRange(selected.model, false, [], model);

      return {
        ...loaded,
        commands: [...(selected.commands ?? []), ...(loaded.commands ?? [])],
      };
    },
    SelectedRectangle: ({ personId, hostKey, keys }) =>
      acceptsSelection(model, personId, hostKey)
        ? {
            model: {
              ...model,
              calendar: {
                ...model.calendar,
                rectangle: Option.none(),
                selected: keys,
              },
            },
          }
        : { model },
    Ticked: ({ now }) => ({
      model: { ...model, calendar: { ...model.calendar, now } },
    }),
    TimeZoneAction: ({ action }) => {
      const timeZones = changeTimeZones(model.timeZones, action);
      const zone = activeZone(timeZones);

      const changed = {
        ...model,
        calendar: { ...model.calendar, zone },
        editing:
          zone === model.calendar.zone
            ? model.editing
            : { ...model.editing, gesture: Option.none() },
        timeZones,
      };

      if (TimeZoneAction.guards.Open(action)) {
        return {
          model: {
            ...changed,
            keyboard: {
              ...changed.keyboard,
              cursor: Option.none(),
              deadline: 0,
              highlighted: "",
              prefix: "",
              query: "",
              screen: "zones",
            },
          },
        };
      }

      const closed: AppModel = {
        ...changed,
        keyboard: {
          ...changed.keyboard,
          cursor: Option.none(),
          highlighted: "",
          query: "",
          screen: "closed",
        },
      };

      const result =
        zone === model.calendar.zone
          ? { model: closed }
          : reloadRange(closed, false, [], model);

      return persistPreferences(result);
    },
  });

export const update = (model: AppModel, message: AppMessage): Result => {
  if (
    (Predicate.isTagged(message, "ReceivedCalendars") ||
      Predicate.isTagged(message, "FailedCalendars")) &&
    message.personId !== undefined &&
    !Option.contains(model.person, message.personId)
  ) {
    return { model };
  }

  const updated = withReminders(
    model,
    withUpcoming(model, updateCore(model, message, update), message)
  );

  const result =
    Option.isSome(updated.model.calendar.rectangle) &&
    (!Predicate.isTagged(updated.model.route, "Calendar") ||
      !EditorView.guards.Closed(updated.model.editing.view) ||
      Option.getOrUndefined(selectionHostKey(model)) !==
        Option.getOrUndefined(selectionHostKey(updated.model)))
      ? {
          ...updated,
          model: {
            ...updated.model,
            calendar: { ...updated.model.calendar, rectangle: Option.none() },
          },
        }
      : updated;

  if (
    Option.getOrUndefined(model.person) !==
    Option.getOrUndefined(result.model.person)
  ) {
    return {
      ...result,
      model: {
        ...result.model,
        attachmentReads: initialAttachmentReads,
        clipboard: resetClipboardScope(model.clipboard),
        settings: {
          ...result.model.settings,
          timeBlockEditor: initialTimeBlockEditor(),
        },
      },
    };
  }

  return withEventAttachmentReads(
    Predicate.isTagged(message, "ReceivedSession")
      ? { ...result, model: { ...result.model, clipboard: model.clipboard } }
      : result
  );
};
