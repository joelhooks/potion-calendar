import { Option, Schema } from "effect";

import { formatClock } from "./time-format.js";
import type { ResolvedTimeFormat } from "./time-format.js";

const Clock24 = Schema.String.check(
  Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
);

const Clock12 = Schema.String.check(
  Schema.isPattern(/^(?:[1-9]|1[0-2])(?::[0-5]\d)?\s?(?:am|pm)$/iu)
);

export const canonicalClockInput = (value: string): string => {
  const trimmed = value.trim();

  if (Option.isSome(Schema.decodeOption(Clock24)(trimmed))) {
    return trimmed;
  }

  if (Option.isNone(Schema.decodeOption(Clock12)(trimmed))) {
    return value;
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
  format: ResolvedTimeFormat
): string => {
  if (Option.isNone(Schema.decodeOption(Clock24)(value))) {
    return value;
  }

  const [hour = "0", minute = "0"] = value.split(":");

  return formatClock(Number(hour) * 60 + Number(minute), format);
};
