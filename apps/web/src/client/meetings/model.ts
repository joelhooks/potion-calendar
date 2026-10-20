import { AgendaKey, MeetingJoinOutcome } from "@calendar/core/desktop-bridge";
import { Schema } from "effect";

export const JoinSelection = Schema.TaggedUnion({
  Available: { conferenceUrl: Schema.String, key: AgendaKey },
  Unavailable: { outcome: MeetingJoinOutcome },
});
