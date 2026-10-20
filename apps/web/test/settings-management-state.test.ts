import { disconnectAccountInstruction } from "@calendar/calendar/contracts";
import type {
  CalendarValue,
  DisconnectAccountResult,
} from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import {
  ManagementChange,
  ManagementOutcome,
  ManagementValue,
  RemovalState,
  initialSettingsManagement,
} from "../src/client/settings-management/model.js";
import {
  projectCalendars,
  replaceCalendar,
} from "../src/client/settings-management/projection.js";
import { changeManagement } from "../src/client/settings-management/update.js";

const calendar: CalendarValue = {
  accessRole: "owner",
  accountId: "work",
  backgroundColor: "#111111",
  calendarId: "primary",
  colorId: "1",
  foregroundColor: "#ffffff",
  primary: true,
  selected: true,
  timeZone: "UTC",
  title: "Original title",
};

const accountInventory = {
  accountId: "work",
  calendars: [calendar],
  colors: {
    calendar: {
      "1": { background: "#111111", foreground: "#ffffff" },
      "2": { background: "#225522", foreground: "#ffffff" },
    },
    event: { "2": { background: "#ff00ff", foreground: "#000000" } },
  },
};

const inventory = { accounts: [accountInventory] };

const accounts = [{ id: "work" }, { id: "personal" }];

const person = Option.some("person");

it.effect.prop(
  "colour previews use the calendar palette and a refusal reveals current inventory without restoring stale metadata",
  { colorId: Schema.Literals(["1", "2"]), title: Schema.String },
  ({ colorId, title }) =>
    Effect.sync(() => {
      const start = changeManagement(
        { accounts, inventory, person, state: initialSettingsManagement() },
        ManagementChange.cases.ChooseColour.make({
          accountId: "work",
          calendarId: "primary",
          colorId,
        })
      );

      if (start.task === undefined) {
        throw new Error("Expected colour task");
      }

      expect(projectCalendars(inventory, start.state)[0]?.backgroundColor).toBe(
        accountInventory.colors.calendar[colorId].background
      );

      const fresh = {
        accounts: [
          {
            ...accountInventory,
            calendars: [
              { ...calendar, backgroundColor: "#333355", colorId: "3", title },
            ],
          },
        ],
      };

      const refused = changeManagement(
        { accounts, inventory: fresh, person, state: start.state },
        ManagementChange.cases.Settled.make({
          outcome: ManagementOutcome.cases.Failed.make({
            problem: { kind: "refused", message: "Not accepted" },
            task: start.task,
          }),
        })
      );

      expect(projectCalendars(fresh, refused.state)).toEqual(
        fresh.accounts[0]?.calendars
      );
      expect(refused.state.colours).toHaveLength(0);
      expect(refused.state.colourProblems).toHaveLength(1);
    })
);

it.effect(
  "a colour reply only replaces its operation-owned fields, preserving newer inventory titles and permissions",
  () =>
    Effect.sync(() => {
      const fresh = {
        accounts: [
          {
            ...accountInventory,
            calendars: [
              {
                ...calendar,
                accessRole: "reader" as const,
                title: "Live rename",
              },
            ],
          },
        ],
      };

      const updated = replaceCalendar(fresh, {
        ...calendar,
        backgroundColor: "#225522",
        colorId: "2",
      });

      expect(updated.accounts[0]).toMatchObject({
        calendars: [
          {
            accessRole: "reader",
            backgroundColor: "#225522",
            colorId: "2",
            title: "Live rename",
          },
        ],
      });
    })
);

it.effect(
  "removal requires confirmation, refuses the last account, and accepts only the current person's matching completion",
  () =>
    Effect.sync(() => {
      const initial = initialSettingsManagement();
      expect(
        changeManagement(
          { accounts, inventory, person, state: initial },
          ManagementChange.cases.ConfirmRemoval.make({ accountId: "work" })
        ).task
      ).toBeUndefined();

      const confirming = changeManagement(
        { accounts, inventory, person, state: initial },
        ManagementChange.cases.Remove.make({ accountId: "work" })
      );

      expect(RemovalState.guards.Confirming(confirming.state.removal)).toBe(
        true
      );

      const last = changeManagement(
        {
          accounts: [{ id: "work" }],
          inventory,
          person,
          state: confirming.state,
        },
        ManagementChange.cases.ConfirmRemoval.make({ accountId: "work" })
      );

      expect(last.task).toBeUndefined();
      expect(RemovalState.guards.Failed(last.state.removal)).toBe(true);

      if (RemovalState.guards.Failed(last.state.removal)) {
        expect(last.state.removal.problem.kind).toBe("lastAccount");
      }

      const writing = changeManagement(
        { accounts, inventory, person, state: confirming.state },
        ManagementChange.cases.ConfirmRemoval.make({ accountId: "work" })
      );

      if (writing.task === undefined) {
        throw new Error("Expected remove task");
      }

      const result: typeof DisconnectAccountResult.Type = {
        accountId: "work",
        disconnected: true,
        instruction: disconnectAccountInstruction,
        revocation: "notAttempted",
      };

      const outcome = ManagementOutcome.cases.Succeeded.make({
        task: writing.task,
        value: ManagementValue.cases.Removed.make({ result }),
      });

      const ignored = changeManagement(
        {
          accounts,
          inventory,
          person: Option.some("other"),
          state: writing.state,
        },
        ManagementChange.cases.Settled.make({ outcome })
      );

      expect(ignored).toEqual({ state: writing.state });

      const done = changeManagement(
        { accounts, inventory, person, state: writing.state },
        ManagementChange.cases.Settled.make({ outcome })
      );

      expect(done.removed).toEqual(result);
      expect(done.state.removedAccounts).toEqual(["work"]);
      expect(projectCalendars(inventory, done.state)).toHaveLength(0);
    })
);
