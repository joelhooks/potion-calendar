import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { transition } from "xstate";
import type { EventFromLogic } from "xstate";

import {
  NotificationPermission,
  ReminderMemory,
  ReminderScan,
  ReminderState,
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
      PERMISSION: Schema.Struct({
        now: Schema.Finite,
        permission: NotificationPermission,
      }),
      REQUEST: Schema.Struct({}),
      SCAN: ReminderScan,
      START: Schema.Struct({ now: Schema.Finite }),
      STOP: Schema.Struct({}),
    },
  },
}).createMachine({
  context: emptyMemory(),
  initial: "stopped",
  on: {
    PERMISSION: ({ context, event }) => {
      const granted = event.permission === "granted";
      const entering = granted && context.permission !== "granted";

      return {
        context: {
          active: granted ? context.active : [],
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
    START: ({ context, event }) => ({
      context: {
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
      },
      target: permissionState(context.permission),
    }),
    STOP: ({ context }) => ({
      context: {
        active: [],
        close: context.active.map((notification) => notification.id),
        deliveries: [],
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
