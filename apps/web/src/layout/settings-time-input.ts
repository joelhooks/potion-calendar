import { Option, Schema } from "effect";

import {
  asciiLocaleDigits,
  deskDefaultFormattingCalendar,
} from "./app-locale.js";
import { formatClock } from "./time-format.js";
import type { ResolvedTimeFormat } from "./time-format.js";

const Clock24 = Schema.String.check(
  Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
);

const Clock12 = Schema.String.check(
  Schema.isPattern(/^(?:[1-9]|1[0-2])(?::[0-5]\d)?\s?(?:am|pm)$/iu)
);

const localizedClockInput = (
  value: string,
  locale: string
): string | undefined => {
  const formatter = new Intl.DateTimeFormat(locale, {
    calendar: deskDefaultFormattingCalendar,
    hour: "numeric",
    hourCycle: "h12",
    minute: "2-digit",
    timeZone: "UTC",
  });

  const samples = [9, 21].map((hour) =>
    formatter.formatToParts(hour * 3_600_000)
  );

  let remaining = asciiLocaleDigits(value, locale)
    .toLocaleLowerCase(locale)
    .trim();

  const periods = samples.map((parts) =>
    parts
      .find((part) => part.type === "dayPeriod")
      ?.value.normalize("NFKC")
      .toLocaleLowerCase(locale)
  );

  const period = periods.findIndex(
    (word) => word !== undefined && remaining.includes(word)
  );

  for (const word of periods) {
    if (word !== undefined) {
      remaining = remaining.replaceAll(word, " ");
    }
  }

  for (const part of samples.flat()) {
    if (part.type === "literal") {
      remaining = remaining.replaceAll(part.value.normalize("NFKC"), " ");
    }
  }

  const groups = /^(?<hour>\d{1,2})(?:\s+(?<minute>\d{2}))?$/u.exec(
    remaining.trim()
  )?.groups;

  if (groups === undefined) {
    return undefined;
  }

  const hour = Number(groups.hour);
  const minute = Number(groups.minute ?? "0");

  if (
    minute > 59 ||
    hour > (period === -1 ? 23 : 12) ||
    (period !== -1 && hour < 1)
  ) {
    return undefined;
  }

  return formatClock(
    (period === -1 ? hour : (hour % 12) + (period === 1 ? 12 : 0)) * 60 +
      minute,
    "24"
  );
};

export const canonicalClockInput = (
  value: string,
  locale = "en-US"
): string => {
  const trimmed = value.trim();

  if (Option.isSome(Schema.decodeOption(Clock24)(trimmed))) {
    return trimmed;
  }

  if (Option.isNone(Schema.decodeOption(Clock12)(trimmed))) {
    return locale === "en-US"
      ? value
      : (localizedClockInput(trimmed, locale) ?? value);
  }

  const afternoon = trimmed.toLowerCase().endsWith("pm");
  const [hour = "0", minute = "0"] = trimmed.slice(0, -2).trim().split(":");

  return formatClock(
    ((Number(hour) % 12) + (afternoon ? 12 : 0)) * 60 + Number(minute),
    "24"
  );
};

export const clockInputLabel = (
  value: string,
  format: ResolvedTimeFormat,
  locale = "en-US"
): string => {
  if (Option.isNone(Schema.decodeOption(Clock24)(value))) {
    return value;
  }

  const [hour = "0", minute = "0"] = value.split(":");

  return formatClock(Number(hour) * 60 + Number(minute), format, locale);
};
