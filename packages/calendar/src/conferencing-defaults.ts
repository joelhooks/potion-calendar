import { Context } from "effect";
import type { Effect } from "effect";

import type { ConferencingDefault } from "./conferencing-model.js";
import type { CalendarFailureValue } from "./errors.js";

export class ConferencingDefaults extends Context.Service<
  ConferencingDefaults,
  {
    readonly forAccount: (
      accountId: string
    ) => Effect.Effect<typeof ConferencingDefault.Type, CalendarFailureValue>;
  }
>()("@calendar/calendar/ConferencingDefaults") {}
