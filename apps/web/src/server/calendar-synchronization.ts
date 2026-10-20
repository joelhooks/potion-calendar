import type {
  CalendarFailureValue,
  CalendarRefValue,
  SyncResultValue,
} from "@calendar/calendar";
import { Context } from "effect";
import type { Effect } from "effect";

export class CalendarSynchronization extends Context.Service<
  CalendarSynchronization,
  {
    readonly run: (
      ref: CalendarRefValue
    ) => Effect.Effect<SyncResultValue, CalendarFailureValue>;
  }
>()("@calendar/web/CalendarSynchronization") {}
