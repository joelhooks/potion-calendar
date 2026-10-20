import type { Effect } from "effect";
import { Context, Schema } from "effect";

import type { Provider } from "./errors.js";
import type {
  CalendarEventValue,
  CalendarRefValue,
  RangeValue,
} from "./model.js";

export const CacheSnapshot = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  revision: Schema.Int,
  version: Schema.Int,
});

export type CacheSnapshotValue = typeof CacheSnapshot.Type;

export class CalendarStore extends Context.Service<
  CalendarStore,
  {
    readonly read: (
      ref: CalendarRefValue
    ) => Effect.Effect<CacheSnapshotValue, Provider>;
    readonly commit: (
      ref: CalendarRefValue,
      expectedRevision: number,
      changed: number,
      cursor: string
    ) => Effect.Effect<boolean, Provider>;
    readonly clear: (
      ref: CalendarRefValue,
      expectedRevision: number
    ) => Effect.Effect<boolean, Provider>;
    readonly invalidate: (
      ref: CalendarRefValue
    ) => Effect.Effect<number, Provider>;
    readonly readRange: (
      ref: CalendarRefValue,
      range: RangeValue,
      version: number
    ) => Effect.Effect<readonly CalendarEventValue[] | undefined, Provider>;
    readonly cacheRange: (
      ref: CalendarRefValue,
      range: RangeValue,
      version: number,
      events: readonly CalendarEventValue[]
    ) => Effect.Effect<boolean, Provider>;
  }
>()("@calendar/calendar/CalendarStore") {}
