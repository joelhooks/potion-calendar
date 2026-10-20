import { Effect } from "effect";

import { ConferencingRefused } from "./conferencing-refused.js";
import type { WriteOptions } from "./google.js";
import type { CalendarEventValue } from "./model.js";

export const followingConferencing = Effect.fn("followingConferencing")(
  function* followingConferencing(
    selected: CalendarEventValue,
    master: CalendarEventValue,
    options: WriteOptions
  ) {
    if (options.conferencingRequest !== undefined) {
      return options;
    }

    const conference = selected.conference ?? master.conference;

    if (
      conference?.kind === "unrepresentable" ||
      (conference === undefined &&
        (selected.conferenceUrl !== undefined ||
          master.conferenceUrl !== undefined))
    ) {
      return yield* new ConferencingRefused({
        accountId: selected.accountId,
        calendarId: selected.calendarId,
        reason: "existingConferenceUnrepresentable",
      });
    }

    if (conference === undefined) {
      return options;
    }

    return {
      ...options,
      conferencingRequest: { conference, kind: "keepExisting" },
    } satisfies WriteOptions;
  }
);
