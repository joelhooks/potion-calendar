import { watchActor } from "@calendar/capability/actor-watch";
import { MeetingJoinOutcome } from "@calendar/core/desktop-bridge";
import { createEffectActor, createEffectLogic, join } from "@xstate/effect";
import { Effect, Schema } from "effect";
import { Command } from "foldkit";

import { Message } from "../message.js";
import { JoinSelection } from "./model.js";
import { MeetingPort } from "./port.js";

const handoffLogic = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* handoffMeeting() {
      if (JoinSelection.guards.Unavailable(input)) {
        return input.outcome;
      }

      const port = yield* MeetingPort;

      return yield* port.open({
        conferenceUrl: input.conferenceUrl,
        key: input.key,
      });
    }),
  schemas: { input: JoinSelection, output: MeetingJoinOutcome },
});

export const JoinMeeting = Command.define("JoinMeeting", {
  args: { personId: Schema.String, selection: JoinSelection },
  execute: ({ personId, selection }) =>
    Effect.gen(function* requestMeeting() {
      const actor = yield* createEffectActor(handoffLogic, {
        input: selection,
      });

      yield* watchActor("calendar.meetings.handoff", actor);
      const outcome = yield* join(actor).pipe(Effect.orDie);

      return Message.FinishedJoinMeeting({ outcome, personId });
    }).pipe(Effect.scoped),
  messages: [Message.FinishedJoinMeeting],
});
