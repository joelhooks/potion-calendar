import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { transition } from "xstate";
import type { EventFromLogic } from "xstate";

import {
  NotificationPermission,
  NativeReminderScan,
  ReminderMemory,
  ReminderSnooze,
  ReminderSnoozeChoice,
  ReminderSnoozeRestore,
  ReminderSnoozeStorage,
  ReminderScan,
  ReminderState,
  reminderSnoozeCanStart,
} from "./model.js";
import { planReminders } from "./planner.js";

const emptyMemory = (): typeof ReminderMemory.Type => ({
  accepted: Option.none(),
  active: [],
  close: [],
  coverage: Option.none(),
  deliveries: [],
  fired: [],
  invitations: {},
  lastChecked: Option.none(),
  permission: "default",
  scope: "",
  snoozeStorage: ReminderSnoozeStorage.cases.Unloaded.make({}),
  snoozes: [],
});

const permissionState = (permission: typeof NotificationPermission.Type) => {
  if (permission === "granted") {
    return ".granted";
  }

  return permission === "default" ? ".permissionUnknown" : ".denied";
};

export const reminderMachine = setupEffect({
  schemas: {
    context: ReminderMemory,
    events: {
      NATIVE_SCAN: NativeReminderScan,
      PERMISSION: Schema.Struct({
        now: Schema.Finite,
        permission: NotificationPermission,
      }),
      REQUEST: Schema.Struct({}),
      SCAN: ReminderScan,
      SNOOZE_LOADING: Schema.Struct({}),
      SNOOZE_REQUESTED: Schema.Struct({
        entry: ReminderSnooze,
        id: Schema.String,
      }),
      SNOOZE_RESTORED: Schema.Struct({
        now: Schema.Finite,
        outcome: ReminderSnoozeRestore,
      }),
      SNOOZE_SAMPLED: Schema.Struct({
        choice: ReminderSnoozeChoice,
        id: Schema.String,
        identity: Schema.String,
      }),
      SNOOZE_SAMPLING: Schema.Struct({
        choice: ReminderSnoozeChoice,
        id: Schema.String,
        identity: Schema.String,
      }),
      SNOOZE_SAVED: Schema.Struct({
        entry: ReminderSnooze,
        failed: Schema.Boolean,
        id: Schema.String,
      }),
      SNOOZE_SESSION_ACCEPTED: Schema.Struct({
        entry: ReminderSnooze,
        id: Schema.String,
      }),
      START: Schema.Struct({ now: Schema.Finite }),
      STOP: Schema.Struct({}),
    },
  },
}).createMachine({
  context: emptyMemory(),
  initial: "stopped",
  on: {
    NATIVE_SCAN: ({ context, event }) => ({
      context: planReminders(context, event),
    }),
    PERMISSION: ({ context, event }) => {
      const granted = event.permission === "granted";
      const entering = granted && context.permission !== "granted";

      return {
        context: {
          active: granted
            ? context.active
            : context.active.filter(
                (notification) => notification.card !== undefined
              ),
          close: granted
            ? []
            : context.active.map((notification) => notification.id),
          coverage:
            entering && Option.isSome(context.coverage)
              ? Option.some(
                  Math.max(
                    event.now,
                    Option.getOrElse(context.lastChecked, () => event.now)
                  )
                )
              : context.coverage,
          deliveries: [],
          lastChecked: entering
            ? Option.some(
                Math.max(
                  event.now,
                  Option.getOrElse(context.lastChecked, () => event.now)
                )
              )
            : context.lastChecked,
          permission: event.permission,
        },
        target: permissionState(event.permission),
      };
    },
    SNOOZE_LOADING: ({ context }) =>
      ReminderSnoozeStorage.guards.Unloaded(context.snoozeStorage) ||
      context.snoozeStorage === undefined
        ? {
            context: {
              snoozeStorage: ReminderSnoozeStorage.cases.Loading.make({}),
            },
          }
        : {},
    SNOOZE_REQUESTED: ({ context, event }) =>
      ReminderSnoozeStorage.guards.Ready(context.snoozeStorage)
        ? {
            context: {
              snoozeStorage: ReminderSnoozeStorage.cases.Saving.make({
                entry: event.entry,
                id: event.id,
              }),
            },
          }
        : {},
    SNOOZE_RESTORED: ({ context, event }) =>
      ReminderSnoozeStorage.guards.Loading(context.snoozeStorage)
        ? {
            context: ReminderSnoozeRestore.guards.Restored(event.outcome)
              ? {
                  snoozeStorage: ReminderSnoozeStorage.cases.Ready.make({}),
                  snoozes: event.outcome.entries.filter(
                    (entry) => entry.due > event.now
                  ),
                }
              : {
                  snoozeStorage: ReminderSnoozeStorage.cases.Failed.make({}),
                },
          }
        : {},
    SNOOZE_SAMPLED: ({ context, event }) =>
      ReminderSnoozeStorage.guards.Sampling(context.snoozeStorage) &&
      context.snoozeStorage.id === event.id &&
      context.snoozeStorage.choice === event.choice &&
      context.snoozeStorage.identity === event.identity
        ? {
            context: {
              snoozeStorage:
                context.snoozeStorage.persistence === "session"
                  ? ReminderSnoozeStorage.cases.Failed.make({})
                  : ReminderSnoozeStorage.cases.Ready.make({}),
            },
          }
        : {},
    SNOOZE_SAMPLING: ({ context, event }) =>
      reminderSnoozeCanStart(context.snoozeStorage)
        ? {
            context: {
              snoozeStorage: ReminderSnoozeStorage.cases.Sampling.make({
                choice: event.choice,
                id: event.id,
                identity: event.identity,
                persistence: ReminderSnoozeStorage.guards.Failed(
                  context.snoozeStorage
                )
                  ? "session"
                  : "durable",
              }),
            },
          }
        : {},
    SNOOZE_SAVED: ({ context, event }) =>
      ReminderSnoozeStorage.guards.Saving(context.snoozeStorage) &&
      context.snoozeStorage.id === event.id &&
      context.snoozeStorage.entry.identity === event.entry.identity &&
      context.snoozeStorage.entry.due === event.entry.due
        ? {
            context: {
              snoozeStorage: ReminderSnoozeStorage.cases.Ready.make({}),
              snoozes: event.failed
                ? (context.snoozes ?? [])
                : [
                    ...(context.snoozes ?? []).filter(
                      (entry) => entry.identity !== event.entry.identity
                    ),
                    event.entry,
                  ],
            },
          }
        : {},
    SNOOZE_SESSION_ACCEPTED: ({ context, event }) =>
      ReminderSnoozeStorage.guards.Failed(context.snoozeStorage)
        ? {
            context: {
              snoozes: [
                ...(context.snoozes ?? []).filter(
                  (entry) => entry.identity !== event.entry.identity
                ),
                event.entry,
              ],
            },
          }
        : {},
    START: ({ context, event }) => {
      const next: typeof ReminderMemory.Type = {
        ...emptyMemory(),
        close: context.active.map((notification) => notification.id),
        fired: context.fired,
        lastChecked: Option.some(
          Math.max(
            event.now,
            Option.getOrElse(context.lastChecked, () => event.now)
          )
        ),
        permission: context.permission,
        snoozeStorage:
          context.snoozeStorage ??
          ReminderSnoozeStorage.cases.Unloaded.make({}),
        snoozes: context.snoozes ?? [],
      };

      return {
        context:
          context.dismissedPrompts === undefined
            ? next
            : { ...next, dismissedPrompts: context.dismissedPrompts },
        target: permissionState(context.permission),
      };
    },
    STOP: ({ context }) => ({
      context: {
        active: [],
        close: context.active.map((notification) => notification.id),
        deliveries: [],
        snoozeStorage: ReminderSnoozeStorage.cases.Unloaded.make({}),
        snoozes: [],
      },
      target: ".stopped",
    }),
  },
  states: {
    denied: {
      on: {
        SCAN: ({ context, event }) => ({
          context: planReminders(context, event),
        }),
      },
    },
    granted: {
      on: {
        SCAN: ({ context, event }) => ({
          context: planReminders(context, event),
          target: "scanning",
        }),
      },
    },
    permissionUnknown: {
      on: {
        REQUEST: {
          context: { close: [], deliveries: [] },
          target: "requesting",
        },
        SCAN: ({ context, event }) => ({
          context: planReminders(context, event),
        }),
      },
    },
    requesting: {
      on: {
        SCAN: ({ context, event }) => ({
          context: planReminders(context, event),
        }),
      },
    },
    scanning: { always: { target: "granted" } },
    stopped: {},
  },
});

export const initialReminderState = (): typeof ReminderState.Type => ({
  context: emptyMemory(),
  failure: Option.none(),
  value: "stopped",
});

export const stepReminder = (
  state: typeof ReminderState.Type,
  event: EventFromLogic<typeof reminderMachine>
): typeof ReminderState.Type => {
  const snapshot = reminderMachine.resolveState({
    context: state.context,
    value: state.value,
  });

  const [next] = transition(reminderMachine, snapshot, event);

  return {
    context: next.context,
    failure: state.failure,
    value: Schema.decodeSync(ReminderState.fields.value)(next.value),
  };
};
