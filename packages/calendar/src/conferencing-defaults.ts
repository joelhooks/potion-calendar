import { Context } from "effect";
import type { Effect } from "effect";

import type { ConferencingDefault } from "./conferencing-model.js";
import type { CustomVideoLink } from "./custom-video-link.js";
import type { CalendarFailureValue } from "./errors.js";

export class ConferencingDefaults extends Context.Service<
  ConferencingDefaults,
  {
    readonly resolveCustomLink: (
      id: string
    ) => Effect.Effect<typeof CustomVideoLink.Type, CalendarFailureValue>;
    readonly forAccount: (
      accountId: string
    ) => Effect.Effect<typeof ConferencingDefault.Type, CalendarFailureValue>;
  }
>()("@calendar/calendar/ConferencingDefaults") {}
