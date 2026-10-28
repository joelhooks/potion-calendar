import type { SettingsUi } from "../client/settings/model.js";
import { deskDefaultFormattingCalendar } from "./app-locale.js";

export type ResolvedTimeFormat = "12" | "24";

export const resolvedTimeFormat = (model: {
  readonly settings: typeof SettingsUi.Type;
}): ResolvedTimeFormat => {
  if (model.settings.timeFormat !== "system") {
    return model.settings.timeFormat;
  }

  return model.settings.system24Hour ? "24" : "12";
};

export const formatClock = (
  minutes: number,
  format: ResolvedTimeFormat = "12",
  locale = "en-US"
): string => {
  const normalized = ((Math.floor(minutes) % 1440) + 1440) % 1440;

  if (locale !== "en-US") {
    return new Intl.DateTimeFormat(locale, {
      calendar: deskDefaultFormattingCalendar,
      hour: "numeric",
      hourCycle: format === "12" ? "h12" : "h23",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(normalized * 60_000);
  }

  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const tail = String(minute).padStart(2, "0");

  if (format === "24") {
    return `${String(hour).padStart(2, "0")}:${tail}`;
  }

  return `${hour % 12 || 12}${minute === 0 ? "" : `:${tail}`}${hour < 12 ? "am" : "pm"}`;
};

export const clockLabel = formatClock;
