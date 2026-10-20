import type {
  CalendarValue,
  CalendarRefValue,
  DisconnectAccountResult,
  ListCalendarsOutput,
} from "@calendar/calendar/contracts";
import { Option, Predicate } from "effect";

import { calendarKey } from "../calendar-state.js";
import {
  ColourTask,
  ManagementChange,
  ManagementOutcome,
  ManagementValue,
  RemovalState,
  RemovalTask,
} from "./model.js";
import type {
  ManagementProblem,
  ManagementTask,
  SettingsManagementValue,
} from "./model.js";

interface Inputs {
  readonly accounts: readonly { readonly id: string }[];
  readonly inventory: typeof ListCalendarsOutput.Type | undefined;
  readonly person: Option.Option<string>;
  readonly state: SettingsManagementValue;
}

export interface ManagementUpdate {
  readonly state: SettingsManagementValue;
  readonly task?: typeof ManagementTask.Type;
  readonly calendar?: CalendarValue;
  readonly removed?: typeof DisconnectAccountResult.Type;
  readonly refresh?: boolean;
}

const unmatchedResponse: typeof ManagementProblem.Type = {
  kind: "unconfirmed",
  message:
    "The response did not match this request. Refresh accounts to check the result.",
};

const same = (left: CalendarRefValue, right: CalendarRefValue): boolean =>
  calendarKey(left.accountId, left.calendarId) ===
  calendarKey(right.accountId, right.calendarId);

const lastAccount = (
  state: SettingsManagementValue,
  accountId: string
): ManagementUpdate => ({
  state: {
    ...state,
    removal: RemovalState.cases.Failed.make({
      accountId,
      problem: {
        kind: "lastAccount",
        message:
          "Keep at least one connected Google account. Add another account before removing this one.",
      },
    }),
  },
});

export const changeManagement = (
  input: Inputs,
  change: typeof ManagementChange.Type
): ManagementUpdate => {
  const { state } = input;

  return ManagementChange.match(change, {
    CancelRemoval: () =>
      RemovalState.guards.Working(state.removal)
        ? { state }
        : { state: { ...state, removal: RemovalState.cases.Closed.make({}) } },
    ChooseColour: (choice) => {
      if (
        Option.isNone(input.person) ||
        state.colours.some((task) => same(task, choice)) ||
        (RemovalState.guards.Working(state.removal) &&
          state.removal.task.accountId === choice.accountId)
      ) {
        return { state };
      }

      const account = input.inventory?.accounts.find(
        (entry) => entry.accountId === choice.accountId
      );

      if (
        account === undefined ||
        !("calendars" in account) ||
        !account.calendars.some((calendar) => same(calendar, choice)) ||
        !Object.hasOwn(account.colors.calendar, choice.colorId)
      ) {
        return { state };
      }

      const task = ColourTask.make({
        accountId: choice.accountId,
        calendarId: choice.calendarId,
        colorId: choice.colorId,
        personId: input.person.value,
        requestId: state.sequence + 1,
      });

      return {
        state: {
          ...state,
          colourProblems: state.colourProblems.filter(
            (entry) => !same(entry, choice)
          ),
          colours: [...state.colours, task],
          picker: Option.none(),
          sequence: task.requestId,
        },
        task,
      };
    },
    ClosePicker: ({ ref }) =>
      ref !== undefined &&
      (Option.isNone(state.picker) || !same(state.picker.value, ref))
        ? { state }
        : { state: { ...state, picker: Option.none() } },
    ConfirmRemoval: ({ accountId }) => {
      if (
        Option.isNone(input.person) ||
        !RemovalState.guards.Confirming(state.removal) ||
        state.removal.accountId !== accountId ||
        !input.accounts.some((account) => account.id === accountId) ||
        state.colours.some((task) => task.accountId === accountId)
      ) {
        return { state };
      }

      if (input.accounts.length <= 1) {
        return lastAccount(state, accountId);
      }

      const task = RemovalTask.make({
        accountId,
        personId: input.person.value,
        requestId: state.sequence + 1,
      });

      return {
        state: {
          ...state,
          removal: RemovalState.cases.Working.make({ task }),
          sequence: task.requestId,
        },
        task,
      };
    },
    OpenPicker: (ref) => ({ state: { ...state, picker: Option.some(ref) } }),
    Remove: ({ accountId }) => {
      if (
        !input.accounts.some((account) => account.id === accountId) ||
        RemovalState.guards.Working(state.removal)
      ) {
        return { state };
      }

      return input.accounts.length <= 1
        ? lastAccount(state, accountId)
        : {
            state: {
              ...state,
              removal: RemovalState.cases.Confirming.make({ accountId }),
            },
          };
    },
    Settled: ({ outcome }) => {
      const { task } = outcome;

      if (!Option.contains(input.person, task.personId)) {
        return { state };
      }

      if (Predicate.isTagged(task, "Colour")) {
        if (
          !state.colours.some(
            (pending) =>
              same(pending, task) && pending.requestId === task.requestId
          )
        ) {
          return { state };
        }

        const next = {
          ...state,
          colours: state.colours.filter((pending) => !same(pending, task)),
        };

        if (ManagementOutcome.guards.Failed(outcome)) {
          return {
            refresh: outcome.problem.kind === "unconfirmed",
            state: {
              ...next,
              colourProblems: [
                ...next.colourProblems.filter((entry) => !same(entry, task)),
                {
                  accountId: task.accountId,
                  calendarId: task.calendarId,
                  problem: outcome.problem,
                },
              ],
            },
          };
        }

        if (
          !ManagementValue.guards.Colour(outcome.value) ||
          !same(outcome.value.calendar, task)
        ) {
          return {
            refresh: true,
            state: {
              ...next,
              colourProblems: [
                ...next.colourProblems.filter((entry) => !same(entry, task)),
                {
                  accountId: task.accountId,
                  calendarId: task.calendarId,
                  problem: unmatchedResponse,
                },
              ],
            },
          };
        }

        return { calendar: outcome.value.calendar, state: next };
      }

      if (
        !RemovalState.guards.Working(state.removal) ||
        state.removal.task.requestId !== task.requestId ||
        state.removal.task.accountId !== task.accountId
      ) {
        return { state };
      }

      if (ManagementOutcome.guards.Failed(outcome)) {
        return {
          refresh: outcome.problem.kind === "unconfirmed",
          state: {
            ...state,
            removal: RemovalState.cases.Failed.make({
              accountId: task.accountId,
              problem: outcome.problem,
            }),
          },
        };
      }

      if (
        !ManagementValue.guards.Removed(outcome.value) ||
        outcome.value.result.accountId !== task.accountId
      ) {
        return {
          refresh: true,
          state: {
            ...state,
            removal: RemovalState.cases.Failed.make({
              accountId: task.accountId,
              problem: unmatchedResponse,
            }),
          },
        };
      }

      const { result } = outcome.value;

      return {
        removed: result,
        state: {
          ...state,
          colourProblems: state.colourProblems.filter(
            (entry) => entry.accountId !== task.accountId
          ),
          colours: state.colours.filter(
            (entry) => entry.accountId !== task.accountId
          ),
          removal: RemovalState.cases.Removed.make({ result }),
          removedAccounts: [
            ...new Set([...state.removedAccounts, task.accountId]),
          ],
        },
      };
    },
  });
};
