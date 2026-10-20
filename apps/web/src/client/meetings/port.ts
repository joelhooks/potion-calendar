import type {
  MeetingJoinOutcomeValue,
  MeetingJoinRequestValue,
} from "@calendar/core/desktop-bridge";
import { Context } from "effect";
import type { Effect } from "effect";

import { browserMeetings } from "./browser.js";

export interface MeetingPortService {
  readonly open: (
    request: MeetingJoinRequestValue
  ) => Effect.Effect<MeetingJoinOutcomeValue>;
}

export const MeetingPort = Context.Reference<MeetingPortService>(
  "@calendar/web/meetings/MeetingPort",
  { defaultValue: browserMeetings }
);
