import type {
  CalendarEventValue,
  CalendarValue,
  EventTimeValue,
} from "@calendar/calendar/contracts";
import { DateTime, Option } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../client/app.js";
import {
  calendarKey,
  eventKey,
  readFailure,
} from "../client/calendar-state.js";
import { selectedOccurrenceEvent } from "../client/selection-commands/projection.js";
import { allDayHeight, packAllDay } from "./all-day.js";
import { deskDefaultFormattingCalendar } from "./app-locale.js";
import { eventColor } from "./colors.js";
import { projectEditingEvents } from "./editing-events.js";
import { mergeEquivalentEvents } from "./equivalent-events.js";
import { minuteInZone, nearFullDay } from "./geometry.js";
import { dayInZone, partsFromDay, visibleDays } from "./navigation.js";
import { primaryAccountId } from "./primary-account.js";
import { selectedSearchResult } from "./search-results.js";
import { primarySelection } from "./selection-set.js";
import { clockLabel } from "./time-format.js";
import type { ResolvedTimeFormat } from "./time-format.js";

export type EventStatus =
  | "accepted"
  | "declined"
  | "unanswered"
  | "tentative"
  | "unconfirmed";

export interface EventCopy {
  readonly calendar: CalendarValue;
  readonly color: string;
  readonly source: CalendarEventValue;
}

export interface DisplayEvent {
  readonly copies: readonly EventCopy[];
  readonly key: string;
  readonly source: CalendarEventValue;
  readonly calendar: CalendarValue;
  readonly color: string;
  readonly title: string;
  readonly status: EventStatus;
  readonly selected: boolean;
  readonly allDay: boolean;
  readonly startDay: number;
  readonly endDay: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

const instant = (time: EventTimeValue): Option.Option<number> =>
  DateTime.make("date" in time ? time.date : time.dateTime).pipe(
    Option.map(DateTime.toEpochMillis)
  );

export const responseStyle = (event: CalendarEventValue): EventStatus => {
  const self = event.attendees?.find(
    (person) => person.self === true
  )?.responseStatus;

  const others =
    event.attendees?.filter((person) => person.self !== true) ?? [];

  if (self === "declined") {
    return "declined";
  }

  if (self === "needsAction") {
    return "unanswered";
  }

  if (
    self === "tentative" ||
    event.status === "tentative" ||
    (self === "accepted" &&
      others.length > 0 &&
      others.every((person) => person.responseStatus === "tentative"))
  ) {
    return "tentative";
  }

  return others.length > 0 &&
    others.every((person) => person.responseStatus === "declined")
    ? "unconfirmed"
    : "accepted";
};

type DisplayTime = Pick<
  DisplayEvent,
  "allDay" | "endDay" | "endMinute" | "startDay" | "startMinute"
>;

const displayTime = (
  from: EventTimeValue,
  until: EventTimeValue,
  zone: string
): DisplayTime | undefined => {
  const dateOnly = "date" in from;
  const parsedStart = instant(from);
  const parsedEnd = instant(until);

  if (
    dateOnly !== "date" in until ||
    Option.isNone(parsedStart) ||
    Option.isNone(parsedEnd)
  ) {
    return undefined;
  }

  const start = parsedStart.value;
  const end = parsedEnd.value;

  if (end < start) {
    return undefined;
  }

  const startDay = dateOnly
    ? Math.floor(start / 86_400_000)
    : dayInZone(start, zone);

  const lastDay = dateOnly
    ? Math.floor(end / 86_400_000)
    : dayInZone(end, zone);

  const startMinute = dateOnly ? 0 : minuteInZone(start, zone);
  const endMinute = dateOnly ? 0 : minuteInZone(end, zone);
  const endDay = dateOnly ? lastDay : lastDay + Number(endMinute > 0);

  return {
    allDay: dateOnly || endDay - startDay > 1 || nearFullDay(start, end, zone),
    endDay: Math.max(startDay + 1, endDay),
    endMinute:
      endMinute === 0 && lastDay > startDay
        ? 1440
        : Math.max(startMinute, endMinute),
    startDay,
    startMinute,
  };
};

export const displayEvent = (
  event: CalendarEventValue,
  calendar: CalendarValue,
  zone: string,
  selected: Option.Option<string>
): DisplayEvent | undefined => {
  if (
    event.start === undefined ||
    event.end === undefined ||
    event.status === "cancelled"
  ) {
    return undefined;
  }

  const time = displayTime(event.start, event.end, zone);

  if (time === undefined) {
    return undefined;
  }

  const key = eventKey(event);
  const title = event.title?.trim() ?? "";

  const color = eventColor(
    event.colorId ?? undefined,
    calendar.backgroundColor ?? "#4986E8"
  );

  return {
    ...time,
    calendar,
    color,
    copies: [{ calendar, color, source: event }],
    key,
    selected: Option.contains(selected, key),
    source: event,
    status: responseStyle(event),
    title: title.length === 0 ? "Untitled event" : title,
  };
};

const selectedUpcomingCopies = (
  model: AppModel
): readonly CalendarEventValue[] => {
  if (Option.isNone(primarySelection(model.calendar.selected))) {
    return [];
  }

  const saved = AsyncData.getData(model.upcoming.data);

  const displayed = Option.isNone(saved)
    ? []
    : saved.value.events.flatMap((event) => {
        const calendar = model.calendar.calendars.find(
          (item) =>
            item.accountId === event.accountId &&
            item.calendarId === event.calendarId
        );

        const item =
          calendar === undefined
            ? undefined
            : displayEvent(event, calendar, model.calendar.zone, Option.none());

        return item === undefined ? [] : [item];
      });

  const session = Option.getOrUndefined(AsyncData.getData(model.session));
  const accounts = session?.accounts ?? [];

  const primaryAccount = primaryAccountId(session);

  const candidates = model.calendar.mergeDuplicates
    ? mergeEquivalentEvents(
        displayed,
        accounts.map((account) => account.id),
        primaryAccount
      )
    : displayed;

  const selected = candidates.find((item) =>
    Option.contains(primarySelection(model.calendar.selected), item.key)
  );

  return selected?.copies.map((copy) => copy.source) ?? [];
};

const unmergedEvents = (model: AppModel): readonly DisplayEvent[] => {
  const raw = model.calendar.reads.flatMap((read) => {
    const result = AsyncData.getData(read.events);

    return Option.isSome(result) ? result.value.events : [];
  });

  const selected = selectedSearchResult(model);

  const events =
    selected !== undefined &&
    !raw.some(
      (event) =>
        event.calendarId === selected.event.calendarId &&
        event.eventId === selected.event.eventId
    )
      ? [...raw, selected.event]
      : raw;

  const occurrence = selectedOccurrenceEvent(model);

  const withOccurrence =
    occurrence !== undefined &&
    !events.some((event) => eventKey(event) === eventKey(occurrence))
      ? [...events, occurrence]
      : events;

  const rangeKeys = new Set(withOccurrence.map(eventKey));

  const projected = [
    ...withOccurrence,
    ...selectedUpcomingCopies(model).filter(
      (event) => !rangeKeys.has(eventKey(event))
    ),
  ];

  return projectEditingEvents(projected, model.editing).flatMap((event) => {
    const calendar = model.calendar.calendars.find(
      (item) =>
        item.accountId === event.accountId &&
        item.calendarId === event.calendarId
    );

    if (
      calendar === undefined ||
      model.calendar.hidden.includes(
        calendarKey(event.accountId, event.calendarId)
      )
    ) {
      return [];
    }

    const item = displayEvent(
      event,
      calendar,
      model.calendar.zone,
      primarySelection(model.calendar.selected)
    );

    const selectedSearchCopy =
      selected !== undefined &&
      selected.event.calendarId === event.calendarId &&
      selected.event.eventId === event.eventId;

    return item === undefined ||
      (model.calendar.hideDeclined &&
        item.status === "declined" &&
        !selectedSearchCopy &&
        (occurrence === undefined || eventKey(occurrence) !== eventKey(event)))
      ? []
      : [item];
  });
};

export const visibleEvents = (model: AppModel): readonly DisplayEvent[] => {
  const events = unmergedEvents(model);

  if (!model.calendar.mergeDuplicates) {
    return events.map((event) => ({
      ...event,
      selected: model.calendar.selected.includes(event.key),
    }));
  }

  const snapshot = AsyncData.getData(model.session);
  const session = Option.getOrUndefined(snapshot);
  const accounts = session?.accounts ?? [];

  const primaryAccount = primaryAccountId(session);

  const searchSelected = selectedSearchResult(model);

  return mergeEquivalentEvents(
    events,
    accounts.map((account) => account.id),
    primaryAccount
  ).map((event) => {
    const selectedCopy =
      searchSelected !== undefined &&
      event.copies.some(
        (copy) =>
          copy.source.calendarId === searchSelected.event.calendarId &&
          copy.source.eventId === searchSelected.event.eventId
      );

    const key = selectedCopy
      ? Option.getOrElse(
          primarySelection(model.calendar.selected),
          () => event.key
        )
      : event.key;

    return {
      ...event,
      key,
      selected: model.calendar.selected.includes(key),
    };
  });
};

export const allDaySection = (
  model: AppModel,
  expanded = model.calendar.allDayExpanded
) => {
  const days = visibleDays(model.calendar.navigation);
  const events = visibleEvents(model).filter((item) => item.allDay);

  const packed = packAllDay(
    events.map((item) => ({
      end: item.endDay,
      id: item.key,
      start: item.startDay,
    })),
    new Map(Object.entries(model.calendar.allDayRows))
  );

  const shown = packed.filter((item) =>
    days.some((day) => item.start <= day && day < item.end)
  );

  const rows = Math.max(0, ...shown.map((item) => item.row + 1));
  const last = days.at(-1) ?? model.calendar.navigation.anchor;

  const continues =
    shown.length > 0 && shown.every((item) => item.end > last + 1);

  return {
    events,
    height: allDayHeight(rows, continues, expanded),
    packed,
    shown,
  };
};

export const accountFailure = (
  model: AppModel,
  accountId: string
): ReturnType<typeof readFailure> | undefined => {
  const index = AsyncData.getData(model.calendar.index);

  const account = Option.isSome(index)
    ? index.value.accounts.find((item) => item.accountId === accountId)
    : undefined;

  if (account !== undefined && "failure" in account) {
    return readFailure(account.failure);
  }

  const read = model.calendar.reads.find(
    (item) => item.accountId === accountId
  );

  return read === undefined
    ? undefined
    : Option.getOrUndefined(AsyncData.getError(read.events));
};

export const dayLabel = (
  day: number,
  options: Intl.DateTimeFormatOptions,
  locale = "en-US"
): string =>
  DateTime.formatUtc(DateTime.makeUnsafe(day * 86_400_000), {
    ...options,
    calendar: deskDefaultFormattingCalendar,
    locale,
  });

export { clockLabel } from "./time-format.js";

export interface DetailWhen {
  readonly date: string;
  readonly time?: string;
}

const allDayDateRange = (
  event: DisplayEvent,
  currentYear: number,
  locale: string
): string => {
  const first = partsFromDay(event.startDay);
  const last = partsFromDay(event.endDay - 1);

  if (first.year !== last.year) {
    return `${dayLabel(event.startDay, { day: "numeric", month: "short", year: "numeric" }, locale)} – ${dayLabel(event.endDay - 1, { day: "numeric", month: "short", year: "numeric" }, locale)}`;
  }

  const from = dayLabel(
    event.startDay,
    { day: "numeric", month: "short" },
    locale
  );

  const year = first.year === currentYear ? "" : `, ${first.year}`;

  if (event.endDay - event.startDay === 1) {
    return `${from}${year}`;
  }

  const until =
    first.month === last.month
      ? String(last.day)
      : dayLabel(event.endDay - 1, { day: "numeric", month: "short" }, locale);

  return `${from} – ${until}${year}`;
};

const timedEndpoint = (
  day: number,
  minute: number,
  showYear: boolean,
  format: ResolvedTimeFormat,
  locale: string
): string =>
  `${dayLabel(day, { day: "numeric", month: "short", weekday: "short", year: showYear ? "numeric" : undefined }, locale)}, ${clockLabel(minute, format, locale)}`;

export const eventWhen = (
  event: DisplayEvent,
  zone: string,
  currentYear: number,
  format: ResolvedTimeFormat = "12",
  locale = "en-US"
): DetailWhen => {
  const { start, end } = event.source;

  if (start === undefined || end === undefined) {
    return { date: "Time unavailable" };
  }

  if ("date" in start) {
    return { date: allDayDateRange(event, currentYear, locale) };
  }

  if (!("dateTime" in end)) {
    return { date: "Time unavailable" };
  }

  const from = DateTime.toEpochMillis(
    DateTime.makeZonedUnsafe(start.dateTime, { timeZone: zone })
  );

  const until = DateTime.toEpochMillis(
    DateTime.makeZonedUnsafe(end.dateTime, { timeZone: zone })
  );

  const firstDay = dayInZone(from, zone);
  const lastDay = dayInZone(until, zone);
  const firstMinute = minuteInZone(from, zone);
  const lastMinute = minuteInZone(until, zone);

  if (firstDay === lastDay) {
    return {
      date: dayLabel(firstDay, { dateStyle: "full" }, locale),
      time: `${clockLabel(firstMinute, format, locale)} – ${clockLabel(lastMinute, format, locale)} · ${zone}`,
    };
  }

  const showYear =
    partsFromDay(firstDay).year !== currentYear ||
    partsFromDay(lastDay).year !== currentYear;

  return {
    date: `${timedEndpoint(firstDay, firstMinute, showYear, format, locale)} – ${timedEndpoint(lastDay, lastMinute, showYear, format, locale)} · ${zone}`,
  };
};
