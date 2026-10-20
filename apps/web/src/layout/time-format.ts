import type { SettingsUi } from "../client/settings/model.js";

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
  format: ResolvedTimeFormat = "12"
): string => {
  const normalized = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const tail = String(minute).padStart(2, "0");

  if (format === "24") {
    return `${String(hour).padStart(2, "0")}:${tail}`;
  }

  return `${hour % 12 || 12}${minute === 0 ? "" : `:${tail}`}${hour < 12 ? "am" : "pm"}`;
};

export const clockLabel = formatClock;
