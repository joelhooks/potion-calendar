import { watchActor } from "@calendar/capability/actor-watch";
import {
  deskDefaultMacNotificationPermission,
  deskDefaultMacNotificationSettingsUrl,
  NotificationSettingsReply,
  NotificationSettingsRequest,
} from "@calendar/core/desktop-bridge";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Effect, Predicate } from "effect";
import { types } from "xstate";

import type { DesktopError } from "./config.js";

export interface NotificationSettingsPort {
  readonly macOS: boolean;
  readonly trusted: Effect.Effect<boolean>;
  readonly supported: Effect.Effect<boolean, DesktopError>;
  readonly open: (url: string) => Effect.Effect<void, DesktopError>;
}

interface NotificationSettingsContext {
  readonly request: typeof NotificationSettingsRequest.Type;
  readonly reply: typeof NotificationSettingsReply.Type | undefined;
}

export const notificationSettingsMachine = (port: NotificationSettingsPort) => {
  const perform = createEffectLogic({
    effect: ({
      input,
    }: {
      readonly input: typeof NotificationSettingsRequest.Type;
    }) =>
      Effect.gen(function* notificationSettingsOperation() {
        if (!(yield* port.trusted)) {
          return NotificationSettingsReply.cases.Failed.make({
            message: "Desktop notification settings request was refused.",
            version: 1,
          });
        }

        if (!port.macOS) {
          return NotificationSettingsReply.cases.Unavailable.make({
            version: 1,
          });
        }

        if (Predicate.isTagged(input, "Read")) {
          const supported = yield* port.supported;

          return NotificationSettingsReply.cases.Read.make({
            permission: {
              authorization: deskDefaultMacNotificationPermission.authorization,
              supported,
            },
            version: 1,
          });
        }

        if (!(yield* port.trusted)) {
          return NotificationSettingsReply.cases.Failed.make({
            message: "Desktop notification settings request was refused.",
            version: 1,
          });
        }

        yield* port.open(deskDefaultMacNotificationSettingsUrl.url);

        return NotificationSettingsReply.cases.Requested.make({ version: 1 });
      }).pipe(
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- This is typed Effect recovery for expected OS handoff failures, not a native Promise callback.
        Effect.orElseSucceed((error) =>
          NotificationSettingsReply.cases.Failed.make({
            message: error.message,
            version: 1,
          })
        )
      ),
  });

  return setupEffect({
    actors: { perform },
    schemas: {
      context: types<NotificationSettingsContext>(),
      input: NotificationSettingsRequest,
    },
  }).createMachine({
    context: ({ input }) => ({ reply: undefined, request: input }),
    initial: "selecting",
    output: ({ context }) => context.reply,
    states: {
      completed: { type: "final" },
      opening: {
        invoke: {
          input: ({ context }) => context.request,
          onDone: {
            context: ({ context, event }) => ({
              ...context,
              reply: event.output,
            }),
            target: "completed",
          },
          src: "perform",
        },
      },
      reading: {
        invoke: {
          input: ({ context }) => context.request,
          onDone: {
            context: ({ context, event }) => ({
              ...context,
              reply: event.output,
            }),
            target: "completed",
          },
          src: "perform",
        },
      },
      selecting: {
        always: ({ context }) => ({
          target: Predicate.isTagged(context.request, "Read")
            ? "reading"
            : "opening",
        }),
      },
    },
  });
};

export const runNotificationSettings = Effect.fn(
  "Desktop.runNotificationSettings"
)(function* runNotificationSettings(
  request: typeof NotificationSettingsRequest.Type,
  port: NotificationSettingsPort
) {
  const actor = yield* createEffectActor(notificationSettingsMachine(port), {
    input: request,
  });

  yield* watchActor("desktopNotificationSettings", actor);
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- XState join exposes unknown machine failures; unexpected failures become defects instead of a successful OS handoff.
  const reply = yield* join(actor).pipe(Effect.orDie);

  if (reply === undefined) {
    return yield* Effect.die(
      new Error("Notification settings completed without a reply")
    );
  }

  return reply;
}, Effect.scoped);
