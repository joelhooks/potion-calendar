import { watchActor } from "@calendar/capability/actor-watch";
import {
  NativeNotificationRef,
  NativeNotificationRequest,
  NativeReminderSnoozeOutcome,
} from "@calendar/core/desktop-bridge";
import { createEffectActor, createEffectLogic, join } from "@xstate/effect";
import { Effect, Option, Schema } from "effect";
import { Command } from "foldkit";

import { browserDesktop } from "../desktop/commands.js";
import { Message } from "../message.js";
import { NotificationFailure } from "./model.js";

const outcomeFields = {
  outcome: NativeReminderSnoozeOutcome,
  ref: NativeNotificationRef,
};

const nativeSnoozeOutcomeLogic = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* publishNativeSnoozeOutcome() {
      const bridge = Option.getOrUndefined(browserDesktop());
      const invoke = bridge?.nativeNotifications;

      if (bridge === undefined || invoke === undefined) {
        return;
      }

      yield* Effect.tryPromise({
        catch: () => new NotificationFailure({ reason: "delivery" }),
        // @effect-diagnostics-next-line asyncFunction:off -- The preload owns this foreign Promise; preserve its receiver at the Effect boundary.
        try: async () =>
          await invoke.call(
            bridge,
            NativeNotificationRequest.cases.SnoozeResult.make({
              ...input,
              version: 1,
            })
          ),
      }).pipe(Effect.ignore);
    }),
  schemas: { input: Schema.Struct(outcomeFields) },
});

export const PublishNativeSnoozeOutcome = Command.define(
  "PublishNativeSnoozeOutcome",
  {
    args: outcomeFields,
    execute: (args) =>
      Effect.gen(function* nativeSnoozeOutcomeCommand() {
        const actor = yield* createEffectActor(nativeSnoozeOutcomeLogic, {
          input: args,
        });

        yield* watchActor("calendar.reminders.native-snooze-outcome", actor);
        yield* join(actor).pipe(Effect.orDie);

        return Message.ReminderEffectCompleted();
      }).pipe(Effect.scoped),
    messages: [Message.ReminderEffectCompleted],
  }
);
