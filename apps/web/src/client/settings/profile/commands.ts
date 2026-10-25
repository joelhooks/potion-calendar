import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, createEffectLogic, join } from "@xstate/effect";
import { Effect, Schema } from "effect";
import { Command } from "foldkit";

import { Message } from "../../message.js";
import {
  ProfileReply,
  ProfileWork,
  profileSaveFailureMessage,
} from "./model.js";
import { ProfilePort } from "./port.js";

export const profileRequestLogic = createEffectLogic({
  effect: ({ input }) =>
    ProfilePort.use((port) =>
      ProfileWork.match(input, {
        Read: (): Effect.Effect<typeof ProfileReply.Type> =>
          port.read.pipe(
            Effect.match({
              onFailure: () =>
                ProfileReply.cases.Failed.make({
                  message: "Your profile could not be loaded. Try again.",
                }),
              onSuccess: (snapshot) =>
                ProfileReply.cases.Loaded.make({ snapshot }),
            })
          ),
        Save: ({ name }): Effect.Effect<typeof ProfileReply.Type> =>
          port.save(name).pipe(
            Effect.match({
              onFailure: () =>
                ProfileReply.cases.Failed.make({
                  message: profileSaveFailureMessage,
                }),
              onSuccess: (saved) =>
                ProfileReply.cases.Saved.make({ name: saved }),
            })
          ),
      })
    ),
  schemas: { input: ProfileWork, output: ProfileReply },
});

export const RunProfileRequest = Command.define("RunProfileRequest", {
  args: { personId: Schema.String, sequence: Schema.Int, work: ProfileWork },
  execute: ({ personId, sequence, work }) =>
    Effect.gen(function* runProfileRequest() {
      const actor = yield* createEffectActor(profileRequestLogic, {
        input: work,
      });

      yield* watchActor("calendar.profile.request", actor);
      const reply = yield* join(actor).pipe(Effect.orDie);

      return Message.ProfileCompleted({ personId, reply, sequence });
    }).pipe(Effect.scoped),
  messages: [Message.ProfileCompleted],
});
