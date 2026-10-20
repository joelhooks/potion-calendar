import { SessionSnapshot } from "@calendar/core/contracts";
import { DateTime, Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import type { Runtime, Update } from "foldkit";

import { packAllDay } from "../layout/all-day.js";
import { hourHeight, minuteInZone } from "../layout/geometry.js";
import {
  dayInZone,
  initialNavigation,
  keyAction,
  midnightInZone,
  navigate,
  visibleDays,
} from "../layout/navigation.js";
import type { NavigationAction } from "../layout/navigation.js";
import { allDaySection, visibleEvents } from "../layout/presentation.js";
import {
  CalendarUi,
  RemoteCalendars,
  RemoteEvents,
  calendarKey,
} from "./calendar-state.js";
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
import { Message } from "./message.js";
import type { AppMessage } from "./message.js";

export { Message } from "./message.js";

export type { AppMessage } from "./message.js";

export const RemoteSession = AsyncData.Schema(SessionSnapshot, Schema.String);

export const Model = Schema.Struct({
  action: Schema.Literals(["idle", "pending"]),
  calendar: CalendarUi,
  error: Schema.Option(Schema.String),
  person: Schema.Option(Schema.String),
  session: RemoteSession.schema,
});

export type AppModel = typeof Model.Type;

type Result = Update.Return<AppModel, AppMessage>;

export const initialModel = (now: number, zone: string): AppModel => ({
  action: "idle",
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
    rangeRequest: 0,
    reads: [],
    scrollbarGutter: 0,
    selected: Option.none(),
    viewport: 700,
    viewportWidth: 1000,
    zone,
    zoom: 0,
  },
  error: Option.none(),
  person: Option.none(),
  session: RemoteSession.Loading(),
});

export const init: Runtime.ApplicationInit<AppModel, AppMessage> = () => ({
  commands: [ReadSession()],
  model: initialModel(
    DateTime.toEpochMillis(DateTime.nowUnsafe()),
    Intl.DateTimeFormat().resolvedOptions().timeZone
  ),
});

export const reloadRange = (model: AppModel): Result => {
  const days = visibleDays(model.calendar.navigation);
  const [first] = days;
  const last = days.at(-1);

  if (first === undefined || last === undefined) {
    return { model };
  }

  const request = model.calendar.rangeRequest + 1;

  const calendars = model.calendar.calendars.filter(
    (item) =>
      !model.calendar.hidden.includes(
        calendarKey(item.accountId, item.calendarId)
      )
  );

  const accounts = [...new Set(calendars.map((item) => item.accountId))];

  const range = {
    end: midnightInZone(last + 1, model.calendar.zone),
    start: midnightInZone(first, model.calendar.zone),
  };

  return {
    commands: accounts.map((accountId) =>
      ReadEvents({
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
        reads: accounts.map((accountId) => ({
          accountId,
          events: RemoteEvents.Loading(),
        })),
      },
    },
  };
};

const changeNavigation = (
  model: AppModel,
  action: NavigationAction
): Result => {
  const navigation = navigate(
    model.calendar.navigation,
    action,
    dayInZone(model.calendar.now, model.calendar.zone)
  );

  const result = reloadRange({
    ...model,
    calendar: { ...model.calendar, navigation, selected: Option.none() },
  });

  return action.type === "today"
    ? {
        ...result,
        commands: [
          ...(result.commands ?? []),
          ScrollToNow({
            minute: minuteInZone(model.calendar.now, model.calendar.zone),
            scale: hourHeight(model.calendar.zoom, model.calendar.viewport),
          }),
        ],
      }
    : result;
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

const pressModifiedKey = (model: AppModel, key: string): Result => {
  switch (key.toLowerCase()) {
    case "e": {
      return changeNavigation(model, { type: "weekends" });
    }

    case "d": {
      return {
        model: {
          ...model,
          calendar: {
            ...model.calendar,
            hideDeclined: !model.calendar.hideDeclined,
          },
        },
      };
    }

    case "a": {
      return toggleAllDay(model);
    }

    case "0": {
      return {
        model: { ...model, calendar: { ...model.calendar, zoom: 0 } },
      };
    }

    case ".": {
      return {
        model: {
          ...model,
          calendar: {
            ...model.calendar,
            zoom: Math.min(20, model.calendar.zoom + 1),
          },
        },
      };
    }

    case ",": {
      return {
        model: {
          ...model,
          calendar: {
            ...model.calendar,
            zoom: Math.max(-4, model.calendar.zoom - 1),
          },
        },
      };
    }

    default: {
      return { model };
    }
  }
};

const pressKey = (
  model: AppModel,
  key: string,
  mod: boolean,
  shift: boolean,
  alt: boolean
): Result => {
  if (mod && shift) {
    return pressModifiedKey(model, key);
  }

  if (mod || alt) {
    return { model };
  }

  if (key === "Escape") {
    return {
      model: {
        ...model,
        calendar: { ...model.calendar, selected: Option.none() },
      },
    };
  }

  const lower = key.toLowerCase();

  if (lower === "j" || lower === "k") {
    const direction = lower === "j" ? 1 : -1;

    return model.calendar.navigation.mode === "days"
      ? changeNavigation(model, {
          day: model.calendar.navigation.anchor + direction * 7,
          type: "date",
        })
      : changeNavigation(model, { direction, type: "page" });
  }

  if (key === "ArrowUp" || key === "ArrowDown") {
    return model.calendar.navigation.mode === "month"
      ? changeNavigation(model, {
          direction: key === "ArrowDown" ? 1 : -1,
          type: "page",
        })
      : { model };
  }

  const action = keyAction(key);

  return action === undefined ? { model } : changeNavigation(model, action);
};

export const update = (model: AppModel, message: AppMessage): Result =>
  Message.match<Result>(message, {
    CalendarChanged: () => reloadRange(model),
    ClickedAddGoogle: () => ({
      commands: [BeginGoogle({ linking: true })],
      model: { ...model, action: "pending", error: Option.none() },
    }),
    ClickedAllDay: () => toggleAllDay(model),
    ClickedCalendar: ({ accountId, calendarId }) => {
      const key = calendarKey(accountId, calendarId);

      const hidden = model.calendar.hidden.includes(key)
        ? model.calendar.hidden.filter((item) => item !== key)
        : [...model.calendar.hidden, key];

      const result = reloadRange({
        ...model,
        calendar: { ...model.calendar, hidden, selected: Option.none() },
      });

      return {
        ...result,
        commands: [
          ...(result.commands ?? []),
          ...(Option.isSome(model.person)
            ? [
                SavePreferences({
                  hidden,
                  mergeDuplicates: model.calendar.mergeDuplicates,
                  person: model.person.value,
                }),
              ]
            : []),
        ],
      };
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
        { day, type: "date" }
      ),
    ClickedDeclined: () => ({
      model: {
        ...model,
        calendar: {
          ...model.calendar,
          hideDeclined: !model.calendar.hideDeclined,
        },
      },
    }),
    ClickedEvent: ({ key }) => ({
      model: {
        ...model,
        calendar: { ...model.calendar, selected: Option.some(key) },
      },
    }),
    ClickedMergeDuplicates: () => {
      const mergeDuplicates = !model.calendar.mergeDuplicates;

      return {
        commands: Option.isSome(model.person)
          ? [
              SavePreferences({
                hidden: model.calendar.hidden,
                mergeDuplicates,
                person: model.person.value,
              }),
            ]
          : [],
        model: receivedEventRows({
          ...model,
          calendar: {
            ...model.calendar,
            mergeDuplicates,
            selected: Option.none(),
          },
        }),
      };
    },
    ClickedPage: ({ direction }) =>
      changeNavigation(model, { direction, type: "page" }),
    ClickedRetry: () => ({
      commands: [ReadCalendars()],
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
    ClickedWeekends: () => changeNavigation(model, { type: "weekends" }),
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
    ClosedDetail: () => ({
      model: {
        ...model,
        calendar: { ...model.calendar, selected: Option.none() },
      },
    }),
    CompletedGridScroll: () => ({ model }),
    FailedAuth: () => ({
      model: {
        ...model,
        action: "idle",
        error: Option.some("The account request failed. Please try again."),
      },
    }),
    FailedCalendars: ({ failure }) => ({
      model: {
        ...model,
        calendar: {
          ...model.calendar,
          index: RemoteCalendars.Failure({ error: failure }),
        },
      },
    }),
    FailedEvents: ({ accountId, failure, request }) =>
      request === model.calendar.rangeRequest
        ? {
            model: {
              ...model,
              calendar: {
                ...model.calendar,
                reads: model.calendar.reads.map((item) =>
                  item.accountId === accountId
                    ? {
                        ...item,
                        events: RemoteEvents.Failure({ error: failure }),
                      }
                    : item
                ),
              },
            },
          }
        : { model },
    FailedPreferences: () => ({
      commands: [ReadCalendars()],
      model: {
        ...model,
        calendar: { ...model.calendar, index: RemoteCalendars.Loading() },
        error: Option.some(
          "Calendar preferences could not be saved on this browser."
        ),
      },
    }),
    FailedSession: () => ({
      model: {
        ...model,
        session: RemoteSession.Failure({
          error: "Could not load your session. Reload to try again.",
        }),
      },
    }),
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
    Navigated: () => ({ model }),
    PressedCalendarKey: ({ key, mod, shift, alt }) =>
      pressKey(model, key, mod, shift, alt),
    ReceivedCalendars: ({ result }) =>
      reloadRange({
        ...model,
        calendar: {
          ...model.calendar,
          calendars: result.accounts.flatMap((account) =>
            "calendars" in account ? account.calendars : []
          ),
          index: RemoteCalendars.Success({ data: result }),
        },
      }),
    ReceivedEvents: ({ accountId, request, result }) =>
      request === model.calendar.rangeRequest
        ? {
            model: receivedEventRows({
              ...model,
              calendar: {
                ...model.calendar,
                reads: model.calendar.reads.map((item) =>
                  item.accountId === accountId
                    ? {
                        ...item,
                        events: RemoteEvents.Success({ data: result }),
                      }
                    : item
                ),
              },
            }),
          }
        : { model },
    ReceivedPreferences: ({ hidden, mergeDuplicates }) => ({
      commands: [ReadCalendars()],
      model: {
        ...model,
        calendar: {
          ...model.calendar,
          hidden,
          index: RemoteCalendars.Loading(),
          mergeDuplicates,
        },
      },
    }),
    ReceivedSession: ({ snapshot }) => {
      const cleared = {
        ...initialModel(model.calendar.now, model.calendar.zone),
        session: RemoteSession.Success({ data: snapshot }),
      };

      if (snapshot === null) {
        return { model: cleared };
      }

      return {
        commands: [ReadPreferences({ person: snapshot.user.id })],
        model: { ...cleared, person: Option.some(snapshot.user.id) },
      };
    },
    SavedPreferences: () => ({ model }),
    Ticked: ({ now }) => ({
      model: { ...model, calendar: { ...model.calendar, now } },
    }),
  });
