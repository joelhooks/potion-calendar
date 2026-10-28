import { DateTime } from "effect";

import {
  ambiguousCalendarWord,
  asciiLocaleDigits,
  calendarWord,
  calendarWords,
  deskDefaultFormattingCalendar,
} from "./app-locale.js";
import { dayFromIso, isoFromDay, partsFromDay } from "./navigation.js";

const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const monthLength = (year: number, month: number): number => {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const absolute = (
  year: number,
  month: number,
  day: number
): number | undefined => {
  if (
    year < 2015 ||
    year > 2040 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthLength(year, month)
  ) {
    return undefined;
  }

  return dayFromIso(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  );
};

const bounded = (day: number): number | undefined =>
  day >= dayFromIso("2015-01-01") && day <= dayFromIso("2040-12-31")
    ? day
    : undefined;

const relativeDate = (query: string, today: number): number | undefined => {
  const groups =
    /^(?:in )?(?<count>\d{1,4}) (?<unit>days?|weeks?|months?|years?)(?<ago> ago)?$/u.exec(
      query
    )?.groups;

  if (groups === undefined) {
    return undefined;
  }

  const count = Number(groups.count) * (groups.ago === undefined ? 1 : -1);
  const unit = groups.unit ?? "";

  if (unit.startsWith("day") || unit.startsWith("week")) {
    return bounded(today + count * (unit.startsWith("week") ? 7 : 1));
  }

  const result = DateTime.add(
    DateTime.makeUnsafe(`${isoFromDay(today)}T00:00:00Z`),
    unit.startsWith("month") ? { months: count } : { years: count }
  );

  return bounded(dayFromIso(DateTime.formatIsoDateUtc(result)));
};

const forwardDate = (
  month: number,
  day: number,
  today: number
): number | undefined => {
  for (let { year } = partsFromDay(today); year <= 2040; year += 1) {
    const result = absolute(year, month, day);

    if (result !== undefined && result >= today) {
      return result;
    }
  }

  return undefined;
};

const localeDateParts = (locale: string, month: "long" | "numeric") =>
  new Intl.DateTimeFormat(locale, {
    calendar: deskDefaultFormattingCalendar,
    day: "numeric",
    month,
    timeZone: "UTC",
    year: "numeric",
  }).formatToParts(
    DateTime.toEpochMillis(DateTime.makeUnsafe("2024-11-23T00:00:00Z"))
  );

const localizedNumericDate = (
  raw: string,
  today: number,
  locale: string
): number | undefined => {
  const values = raw.split(/[/.-]/u).map(Number);

  const order = localeDateParts(locale, "numeric")
    .filter((part) => ["year", "month", "day"].includes(part.type))
    .filter((part) => values.length === 3 || part.type !== "year")
    .map((part) => part.type);

  const month = values[order.indexOf("month")];
  const day = values[order.indexOf("day")];
  const year = values[order.indexOf("year")];

  if (month === undefined || day === undefined) {
    return undefined;
  }

  return year === undefined
    ? forwardDate(month, day, today)
    : absolute(year, month, day);
};

const localizedGoToDate = (
  input: string,
  today: number,
  locale: string
): number | undefined => {
  const raw = asciiLocaleDigits(input, locale).trim();
  const query = calendarWord(raw, locale);

  if (query === "") {
    return undefined;
  }

  const named = new Map([
    ["today", 0],
    ["tomorrow", 1],
    ["yesterday", -1],
  ]).get(query);

  if (named !== undefined) {
    return bounded(today + named);
  }

  const relative = relativeDate(query, today);

  if (relative !== undefined) {
    return relative;
  }

  const iso = /^(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})$/u.exec(
    raw
  )?.groups;

  if (iso !== undefined) {
    return absolute(Number(iso.year), Number(iso.month), Number(iso.day));
  }

  if (/^\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{1,4})?$/u.test(raw)) {
    return localizedNumericDate(raw, today, locale);
  }

  const words = calendarWords(locale);
  const weekdayWord = query.replace(/^next /u, "");

  const weekday = words.find(
    (entry) => entry.kind === "weekday" && entry.word === weekdayWord
  );

  if (weekday !== undefined) {
    return ambiguousCalendarWord(weekdayWord)
      ? undefined
      : bounded(
          today + ((weekday.value - partsFromDay(today).weekDay + 6) % 7) + 1
        );
  }

  const [month] = words
    .filter((entry) => entry.kind === "month" && query.includes(entry.word))
    .toSorted((left, right) => right.word.length - left.word.length);

  if (month === undefined || ambiguousCalendarWord(month.word)) {
    return undefined;
  }

  let remainder = query.replace(month.word, " ");

  for (const part of localeDateParts(locale, "long")) {
    if (part.type === "literal") {
      const literal = calendarWord(part.value, locale);

      if (literal !== "") {
        remainder = remainder.replaceAll(literal, " ");
      }
    }
  }

  const numbers = remainder.trim().split(/\s+/u);

  if (
    numbers.length > 2 ||
    numbers.some((value) => !/^\d{1,4}$/u.test(value))
  ) {
    return undefined;
  }

  const year = numbers.find((value) => value.length === 4);
  const day = numbers.find((value) => value.length <= 2);

  if (day === undefined || (numbers.length === 2 && year === undefined)) {
    return undefined;
  }

  return year === undefined
    ? forwardDate(month.value, Number(day), today)
    : absolute(Number(year), month.value, Number(day));
};

export const parseGoToDate = (
  input: string,
  today: number,
  locale = "en-US"
): number | undefined => {
  if (locale !== "en-US") {
    return localizedGoToDate(input, today, locale);
  }

  const query = input
    .trim()
    .toLowerCase()
    .replaceAll(",", "")
    .replaceAll(/\s+/gu, " ");

  if (query === "") {
    return undefined;
  }

  const named = new Map([
    ["today", 0],
    ["tomorrow", 1],
    ["yesterday", -1],
  ]).get(query);

  if (named !== undefined) {
    return bounded(today + named);
  }

  const relative = relativeDate(query, today);

  if (relative !== undefined) {
    return relative;
  }

  const weekday = weekdays.findIndex(
    (name) => query === name || query === `next ${name}`
  );

  if (weekday !== -1) {
    return bounded(
      today + ((weekday - partsFromDay(today).weekDay + 6) % 7) + 1
    );
  }

  const iso = /^(?<year>\d{4})-(?<month>\d{1,2})-(?<day>\d{1,2})$/u.exec(
    query
  )?.groups;

  if (iso !== undefined) {
    return absolute(Number(iso.year), Number(iso.month), Number(iso.day));
  }

  const text = /^(?<month>[a-z]+) (?<day>\d{1,2})(?: (?<year>\d{4}))?$/u.exec(
    query
  )?.groups;

  const numeric =
    /^(?<month>\d{1,2})\/(?<day>\d{1,2})(?:\/(?<year>\d{4}))?$/u.exec(
      query
    )?.groups;

  const match = text ?? numeric;

  if (match === undefined) {
    return undefined;
  }

  const month =
    text === undefined
      ? Number(match.month)
      : months.findIndex(
          (name) => name === match.month || name.slice(0, 3) === match.month
        ) + 1;

  const day = Number(match.day);

  return match.year === undefined
    ? forwardDate(month, day, today)
    : absolute(Number(match.year), month, day);
};

export const dateChoiceLabel = (
  day: number,
  today: number,
  locale = "en-US"
): string => {
  const options: Intl.DateTimeFormatOptions & { locale: string } = {
    calendar: deskDefaultFormattingCalendar,
    day: "numeric",
    locale,
    month: "long",
    timeZone: "UTC",
    weekday: "long",
  };

  if (partsFromDay(day).year !== partsFromDay(today).year) {
    options.year = "numeric";
  }

  return DateTime.format(
    DateTime.makeUnsafe(`${isoFromDay(day)}T00:00:00Z`),
    options
  );
};
