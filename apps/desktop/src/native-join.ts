import { watchActor } from "@calendar/capability/actor-watch";
import {
  ConferenceUrl,
  MeetingJoinOutcome,
} from "@calendar/core/desktop-bridge";
import type { MeetingJoinRequestValue } from "@calendar/core/desktop-bridge";
import { createEffectActor, createEffectLogic, join } from "@xstate/effect";
import { Effect, Schema } from "effect";

import type { DesktopError } from "./config.js";

export const runNativeJoin = Effect.fn("Desktop.runNativeJoin")(
  function* runNativeJoin(
    request: MeetingJoinRequestValue,
    open: (url: string) => Effect.Effect<void, DesktopError>
  ) {
    const logic = createEffectLogic({
      effect: ({ input }: { readonly input: MeetingJoinRequestValue }) =>
        Effect.gen(function* openMeeting() {
          const url = yield* Schema.decodeEffect(ConferenceUrl)(
            input.conferenceUrl
          );

          yield* open(url);

          return MeetingJoinOutcome.cases.Requested.make({ key: input.key });
        }).pipe(
          Effect.orElseSucceed(() =>
            MeetingJoinOutcome.cases.Failed.make({
              message: "The meeting could not be opened.",
            })
          )
        ),
    });

    const actor = yield* createEffectActor(logic, { input: request });
    yield* watchActor("desktopMeetingJoin", actor);

    return yield* join(actor).pipe(Effect.orDie);
  },
  Effect.scoped
);
