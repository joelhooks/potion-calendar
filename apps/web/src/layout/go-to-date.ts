import { DateTime } from "effect";

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

export const parseGoToDate = (
  input: string,
  today: number
): number | undefined => {
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

export const dateChoiceLabel = (day: number, today: number): string => {
  const options: Intl.DateTimeFormatOptions & { locale: string } = {
    day: "numeric",
    locale: "en-US",
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
