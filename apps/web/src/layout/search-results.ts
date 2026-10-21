import { equivalenceKey } from "@calendar/calendar/contracts";
import type { SearchEventResultValue } from "@calendar/calendar/contracts";
import { Option, Predicate } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../client/app.js";
import { eventKey } from "../client/calendar-state.js";
import type { SearchProblem } from "../client/search/model.js";
import type {
  SearchAccountFailure,
  SearchResponse,
} from "../search-contract.js";
import { dayInZone } from "./navigation.js";
import { primarySelection } from "./selection-set.js";

export interface SearchDay {
  readonly day: number;
  readonly today: boolean;
  readonly noUpcoming: boolean;
  readonly results: readonly SearchEventResultValue[];
}

export const searchDays = (
  results: readonly SearchEventResultValue[],
  now: number,
  zone: string
): readonly SearchDay[] => {
  if (results.length === 0) {
    return [];
  }

  const today = dayInZone(now, zone);
  const groups = new Map<number, SearchEventResultValue[]>([[today, []]]);

  for (const result of results) {
    const day = dayInZone(result.startMillis, zone);
    const current = groups.get(day) ?? [];
    current.push(result);
    groups.set(day, current);
  }

  const pastOnly = results.every(
    (result) => dayInZone(result.startMillis, zone) < today
  );

  return [...groups]
    .toSorted(([a], [b]) => a - b)
    .map(([day, values]) => ({
      day,
      noUpcoming: day === today && pastOnly,
      results: values.toSorted(
        (a, b) =>
          a.startMillis - b.startMillis ||
          eventKey(a.event).localeCompare(eventKey(b.event))
      ),
      today: day === today,
    }));
};

const accountEmail = (model: AppModel, accountId: string): string =>
  Option.getOrUndefined(AsyncData.getData(model.session))
    ?.accounts.find((account) => account.id === accountId)
    ?.email.trim() ?? "";

const accountFailureLine = (
  { accountId, failure }: typeof SearchAccountFailure.Type,
  model: AppModel
): string => {
  const email = accountEmail(model, accountId);
  const subject = email === "" ? "one account" : email;

  return `Couldn't search ${subject}.${Predicate.isTagged(failure, "Revoked") ? " Reconnect this account to include it." : ""}`;
};

export const searchFailureLines = (
  response: typeof SearchResponse.Type,
  model: AppModel
): readonly string[] => [
  ...response.accountFailures.map((failure) =>
    accountFailureLine(failure, model)
  ),
  ...response.failures.map(({ accountId, calendarId }) => {
    const calendar = model.calendar.calendars.find(
      (item) => item.accountId === accountId && item.calendarId === calendarId
    );

    const title = calendar?.title.trim() ?? "";
    const email = accountEmail(model, accountId);

    return `Couldn't search ${title === "" ? "one calendar" : title}${email === "" ? "" : ` (${email})`}.`;
  }),
];

export const searchProblemLines = (
  problem: typeof SearchProblem.Type,
  model: AppModel
): readonly string[] => {
  if (Predicate.isTagged(problem, "Transport")) {
    const message = problem.message.trim();

    return [message === "" ? "Couldn't search events. Try again." : message];
  }

  const { failure } = problem;

  if (Predicate.isTagged(failure, "SearchInventoryUnavailable")) {
    if (failure.reason === "noAccounts") {
      return ["Connect a Google account to search events."];
    }

    return failure.accountFailures.length === 0
      ? ["Couldn't search accounts. Try again."]
      : failure.accountFailures.map((item) => accountFailureLine(item, model));
  }

  return ["Couldn't search events. Try again."];
};

export const searchResult = (
  model: AppModel,
  key: string
): SearchEventResultValue | undefined =>
  Option.getOrUndefined(model.search.response)?.results.find(
    (result) => eventKey(result.event) === key
  );

export const searchSelectionKey = (
  result: SearchEventResultValue,
  mergeDuplicates: boolean
): string => {
  const identity = equivalenceKey(result.event);

  return mergeDuplicates && identity !== undefined
    ? JSON.stringify(["equivalent", identity])
    : eventKey(result.event);
};

export const selectedSearchResult = (
  model: AppModel
): SearchEventResultValue | undefined =>
  Option.isSome(primarySelection(model.calendar.selected))
    ? Option.getOrUndefined(model.search.response)?.results.find((result) =>
        Option.contains(
          primarySelection(model.calendar.selected),
          searchSelectionKey(result, model.calendar.mergeDuplicates)
        )
      )
    : undefined;
