import { Context, Effect, Schema } from "effect";

import { CalendarRef } from "./model.js";

export const CalendarChanged = Schema.Struct({
  ...CalendarRef.fields,
  reason: Schema.Literals(["sync", "reset", "write"]),
  version: Schema.Int,
});

export type CalendarChangedValue = typeof CalendarChanged.Type;

export const CalendarChanges = Context.Reference<{
  readonly publish: (change: CalendarChangedValue) => Effect.Effect<void>;
}>("@calendar/calendar/CalendarChanges", {
  defaultValue: () => ({ publish: () => Effect.void }),
});
