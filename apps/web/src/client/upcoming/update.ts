import type { CalendarRefValue } from "@calendar/calendar/contracts";
import { DateTime, Match, Option, Predicate } from "effect";
import { AsyncData } from "foldkit";
import type { Update } from "foldkit";

import type { AppModel } from "../app.js";
import { RemoteEvents, calendarKey } from "../calendar-state.js";
import { noticeAffectsSelection } from "../live/socket.js";
import type { AppMessage } from "../message.js";
import {
  initialUpcoming,
  upcomingHorizonMilliseconds,
  upcomingRefreshMilliseconds,
} from "./model.js";
import type { UpcomingReceiptValue } from "./model.js";

export const upcomingSelection = (
  model: AppModel
): readonly CalendarRefValue[] => {
  const selected = new Map(
    model.calendar.calendars
      .filter(
        (calendar) =>
          !model.calendar.hidden.includes(
            calendarKey(calendar.accountId, calendar.calendarId)
          )
      )
      .map(({ accountId, calendarId }) => [
        calendarKey(accountId, calendarId),
        { accountId, calendarId },
      ])
  );

  return [...selected.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, ref]) => ref);
};

const sameSelection = (
  left: readonly CalendarRefValue[],
  right: readonly CalendarRefValue[]
) =>
  left.length === right.length &&
  left.every(
    (ref, index) =>
      ref.accountId === right[index]?.accountId &&
      ref.calendarId === right[index]?.calendarId
  );

const beginUpcoming = (
  model: AppModel,
  calendars: readonly CalendarRefValue[],
  personId: string,
  origin: UpcomingReceiptValue["origin"]
): AppModel => {
  const { now } = model.calendar;
  const request = model.upcoming.request + 1;

  const previous =
    Option.isSome(model.upcoming.query) &&
    sameSelection(calendars, model.upcoming.query.value.calendars)
      ? AsyncData.getData(model.upcoming.data)
      : Option.none();

  return {
    ...model,
    upcoming: {
      accepted: Option.isSome(previous)
        ? model.upcoming.accepted
        : Option.none(),
      data:
        calendars.length === 0
          ? RemoteEvents.Success({ data: { events: [], versions: [] } })
          : Option.match(previous, {
              onNone: () => RemoteEvents.Loading(),
              onSome: (data) => RemoteEvents.Refreshing({ data }),
            }),
      query:
        calendars.length === 0
          ? Option.none()
          : Option.some({
              calendars,
              origin,
              personId,
              range: {
                end: DateTime.formatIso(
                  DateTime.makeUnsafe(now + upcomingHorizonMilliseconds)
                ),
                start: DateTime.formatIso(DateTime.makeUnsafe(now)),
              },
              request,
            }),
      refreshAt:
        (Math.floor(now / upcomingRefreshMilliseconds) + 1) *
        upcomingRefreshMilliseconds,
      request,
    },
  };
};

type AppUpdate<R> = Update.Return<AppModel, AppMessage, R>;

const liveRefresh = (
  model: AppModel,
  message: AppMessage,
  calendars: readonly CalendarRefValue[]
) =>
  Predicate.isTagged(message, "ReceivedLive") &&
  Option.contains(model.person, message.personId) &&
  noticeAffectsSelection(message.notice, calendars);

const refreshTriggered = (
  previous: AppModel,
  next: AppModel,
  message: AppMessage,
  calendars: readonly CalendarRefValue[]
) =>
  Match.value(message).pipe(
    Match.tag("ReceivedCalendars", () => AsyncData.isIdle(next.upcoming.data)),
    Match.tag(
      "Ticked",
      () =>
        next.calendar.now >= next.upcoming.refreshAt ||
        next.calendar.now < previous.calendar.now
    ),
    Match.tag("ReceivedLive", () => liveRefresh(next, message, calendars)),
    Match.tag(
      "ReceivedEditing",
      () => previous.calendar.rangeRequest !== next.calendar.rangeRequest
    ),
    Match.tag("CalendarChanged", () => true),
    Match.tag("ClickedRefresh", () => true),
    Match.orElse(() => false)
  );

export const withUpcoming = <R>(
  previous: AppModel,
  result: AppUpdate<R>,
  message: AppMessage
): AppUpdate<R> => {
  const next = result.model;

  if (
    Predicate.isTagged(message, "ReceivedSession") ||
    Predicate.isTagged(message, "ClickedSignOut")
  ) {
    return {
      ...result,
      model: {
        ...next,
        upcoming: initialUpcoming(previous.upcoming.request + 1),
      },
    };
  }

  if (
    Option.isNone(next.person) ||
    next.action === "pending" ||
    previous.upcoming.request !== next.upcoming.request
  ) {
    return result;
  }

  const calendars = upcomingSelection(next);

  const selectionChanged = !sameSelection(
    upcomingSelection(previous),
    calendars
  );

  if (Option.isNone(AsyncData.getData(next.calendar.index))) {
    return selectionChanged
      ? {
          ...result,
          model: {
            ...next,
            upcoming: initialUpcoming(next.upcoming.request + 1),
          },
        }
      : result;
  }

  return selectionChanged ||
    refreshTriggered(previous, next, message, calendars)
    ? {
        ...result,
        model: beginUpcoming(
          next,
          calendars,
          next.person.value,
          liveRefresh(next, message, calendars) ? "live" : "snapshot"
        ),
      }
    : result;
};

export const receiveUpcoming = (
  model: AppModel,
  message: Extract<AppMessage, { readonly _tag: "ReceivedUpcoming" }>
): AppModel =>
  Option.contains(model.person, message.personId) &&
  model.upcoming.request === message.request &&
  Option.isSome(model.upcoming.query)
    ? {
        ...model,
        upcoming: {
          ...model.upcoming,
          accepted: Option.some({
            origin: model.upcoming.query.value.origin,
            request: model.upcoming.query.value.request,
          }),
          data: RemoteEvents.Success({ data: message.result }),
        },
      }
    : model;

export const failUpcoming = (
  model: AppModel,
  message: Extract<AppMessage, { readonly _tag: "FailedUpcoming" }>
): AppModel => {
  if (
    !Option.contains(model.person, message.personId) ||
    model.upcoming.request !== message.request ||
    Option.isNone(model.upcoming.query)
  ) {
    return model;
  }

  return {
    ...model,
    upcoming: {
      ...model.upcoming,
      data: Option.match(AsyncData.getData(model.upcoming.data), {
        onNone: () => RemoteEvents.Failure({ error: message.failure }),
        onSome: (data) => RemoteEvents.Stale({ data, error: message.failure }),
      }),
    },
  };
};
