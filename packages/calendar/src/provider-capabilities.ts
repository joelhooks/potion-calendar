import { Schema } from "effect";

export const CalendarProviderCapabilities = Schema.Struct({
  maxRemindersCount: Schema.Int,
});

export type CalendarProviderCapabilitiesValue =
  typeof CalendarProviderCapabilities.Type;

export const googleCalendarCapabilities = CalendarProviderCapabilities.make({
  maxRemindersCount: 5,
});
