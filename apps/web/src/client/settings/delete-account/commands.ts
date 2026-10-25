import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, createEffectLogic, join } from "@xstate/effect";
import { Effect, Schema } from "effect";
import { Command } from "foldkit";

import { Message } from "../../message.js";
import { clearReminderSnoozes } from "../../reminders/snooze-storage.js";
import { clearPreferences } from "../preference-storage.js";
import { AccountDeletionReply } from "./model.js";
import { AccountDeletionPort } from "./port.js";

const Input = Schema.Struct({ personId: Schema.String, proof: Schema.String });

export const accountDeletionRequestLogic = createEffectLogic({
  effect: ({ input }) =>
    AccountDeletionPort.use((port) => port.remove(input.proof)).pipe(
      Effect.andThen(
        Effect.gen(function* clearDeletedPersonPreferences() {
          yield* clearPreferences(input.personId).pipe(
            Effect.catchCause(() =>
              Effect.logWarning(
                "Deleted account preference cleanup did not complete"
              )
            )
          );
          yield* clearReminderSnoozes(input.personId).pipe(
            Effect.catchCause(() =>
              Effect.logWarning(
                "Deleted account snooze cleanup did not complete"
              )
            )
          );
        })
      ),
      Effect.match({
        onFailure: () => AccountDeletionReply.cases.Failed.make({}),
        onSuccess: () => AccountDeletionReply.cases.Deleted.make({}),
      })
    ),
  schemas: { input: Input, output: AccountDeletionReply },
});

export const RunAccountDeletion = Command.define("RunAccountDeletion", {
  args: { personId: Schema.String, proof: Schema.String, sequence: Schema.Int },
  execute: ({ personId, proof, sequence }) =>
    Effect.gen(function* runAccountDeletion() {
      const actor = yield* createEffectActor(accountDeletionRequestLogic, {
        input: { personId, proof },
      });

      yield* watchActor("calendar.account.deletion.request", actor);
      const reply = yield* join(actor).pipe(Effect.orDie);

      return Message.AccountDeletionCompleted({ personId, reply, sequence });
    }).pipe(Effect.scoped),
  messages: [Message.AccountDeletionCompleted],
});
