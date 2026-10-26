import { expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";

import { stepReminder } from "../src/client/reminders/machine.js";
import type {
  ReminderScan,
  ReminderState,
} from "../src/client/reminders/model.js";
import {
  candidatesFor,
  reminderEvent,
  reminderEpoch,
  startedReminders,
} from "./reminders-fixture.js";

const scanReminders = (
  state: typeof ReminderState.Type,
  minutes: number,
  changes: Partial<typeof ReminderScan.Type> & {
    native: boolean;
    nativeEnabled: boolean;
  }
) =>
  stepReminder(state, {
    accepted:
      changes.accepted ??
      Option.some({
        origin: "snapshot",
        request: Option.getOrElse(state.context.accepted, () => 1),
      }),
    candidates: changes.candidates ?? [],
    eventInvites: true,
    native: true,
    nativeEnabled: changes.nativeEnabled,
    now: reminderEpoch + minutes * 60_000,
    personId: "fixture-person",
    scope: "fixture-selection",
    snoozeRangeReady: undefined,
    type: "NATIVE_SCAN",
    webCards: false,
  });

it.prop(
  "native Mac uses the existing fired set and selects one presentation for all crossed offsets",
  [Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 1 }))],
  ([offset]) => {
    const original = reminderEvent(0, {
      reminders: {
        overrides: [
          { method: "popup", minutes: offset },
          { method: "popup", minutes: 0 },
        ],
        useDefault: false,
      },
    });

    const candidates = candidatesFor([
      original,
      {
        ...original,
        accountId: "other",
        calendarId: "shared",
        eventId: "equivalent-copy",
      },
    ]);

    expect(candidates).toHaveLength(1);

    const before = scanReminders(startedReminders(), 59 - offset, {
      candidates,
      native: true,
      nativeEnabled: true,
    });

    const after = scanReminders(before, 60, {
      candidates,
      native: true,
      nativeEnabled: true,
    });

    expect(after.context.deliveries).toHaveLength(1);
    expect(after.context.deliveries[0]?.nativeKind).toBe("reminder");
    expect(after.context.deliveries[0]?.card).toBeUndefined();
    expect(after.context.fired).toHaveLength(2);
    expect(
      scanReminders(after, 60, {
        candidates,
        native: true,
        nativeEnabled: true,
      }).context.deliveries
    ).toEqual([]);
    expect(
      scanReminders(after, 61, {
        accepted: Option.some({ origin: "live", request: 2 }),
        candidates,
        native: true,
        nativeEnabled: true,
      }).context.deliveries
    ).toEqual([]);
  }
);

it.prop(
  "native admission does not require or rewrite browser permission",
  [Schema.Literals(["default", "denied", "unsupported"])],
  ([permission]) => {
    const initial = stepReminder(startedReminders(), {
      now: reminderEpoch,
      permission,
      type: "PERMISSION",
    });

    const candidates = candidatesFor([
      reminderEvent(0, {
        reminders: {
          overrides: [{ method: "popup", minutes: 0 }],
          useDefault: false,
        },
      }),
    ]);

    const baseline = scanReminders(initial, 58, {
      candidates,
      native: true,
      nativeEnabled: true,
    });

    const due = scanReminders(baseline, 60, {
      candidates,
      native: true,
      nativeEnabled: true,
    });

    expect(due.context.deliveries).toHaveLength(1);
    expect(due.context.permission).toBe(permission);
  }
);

it.prop(
  "menu bar off advances the existing coverage watermark without a replay backlog on a fresh accepted read",
  [Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 1 }))],
  ([offset]) => {
    const candidates = candidatesFor([
      reminderEvent(0, {
        reminders: {
          overrides: [{ method: "popup", minutes: offset }],
          useDefault: false,
        },
      }),
    ]);

    const initial = scanReminders(startedReminders(), 59 - offset, {
      candidates,
      native: true,
      nativeEnabled: true,
    });

    const disabled = scanReminders(initial, 60, {
      candidates,
      native: true,
      nativeEnabled: false,
    });

    const enabled = scanReminders(disabled, 61, {
      accepted: Option.some({ origin: "live", request: 2 }),
      candidates,
      native: true,
      nativeEnabled: true,
    });

    expect(disabled.context.deliveries).toEqual([]);
    expect(enabled.context.deliveries).toEqual([]);
  }
);
