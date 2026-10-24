import {
  orderSearchResults,
  SearchPageTarget,
} from "@calendar/calendar/contracts";
import type {
  CalendarRefValue,
  SearchContinuation,
} from "@calendar/calendar/contracts";

import type { SearchResponse } from "../../search-contract.js";
import { calendarKey } from "../calendar-state.js";

type Response = typeof SearchResponse.Type;

type Continuation = typeof SearchContinuation.Type;

const refKey = (ref: CalendarRefValue): string =>
  calendarKey(ref.accountId, ref.calendarId);

export const forwardSearchTargets = (
  response: Response
): readonly (typeof SearchPageTarget.Type)[] => {
  const failed = new Set(response.failures.map(refKey));

  const failedAccounts = new Set(
    response.accountFailures.map((failure) => failure.accountId)
  );

  return response.pageInfo.flatMap((page) =>
    page.forwardNextPageToken === undefined ||
    failed.has(refKey(page)) ||
    failedAccounts.has(page.accountId)
      ? []
      : [
          SearchPageTarget.cases.Forward.make({
            accountId: page.accountId,
            calendarId: page.calendarId,
            pageToken: page.forwardNextPageToken,
          }),
        ]
  );
};

export const reverseSearchTargets = (
  response: Response
): readonly (typeof SearchPageTarget.Type)[] => {
  const failed = new Set(response.failures.map(refKey));

  const accounts = new Set(
    response.accountFailures.map((failure) => failure.accountId)
  );

  return response.pageInfo.flatMap((page) =>
    page.olderCursor === undefined ||
    failed.has(refKey(page)) ||
    accounts.has(page.accountId)
      ? []
      : [
          SearchPageTarget.cases.Reverse.make({
            accountId: page.accountId,
            calendarId: page.calendarId,
            ...page.olderCursor,
          }),
        ]
  );
};

export const failedSearchTarget = (
  response: Response,
  ref: CalendarRefValue
): typeof SearchPageTarget.Type | undefined => {
  if (!response.failures.some((failure) => refKey(failure) === refKey(ref))) {
    return undefined;
  }

  const previous = response.pageInfo.find(
    (page) => refKey(page) === refKey(ref)
  );

  return previous?.forwardNextPageToken === undefined
    ? SearchPageTarget.cases.Initial.make(ref)
    : SearchPageTarget.cases.Forward.make({
        ...ref,
        pageToken: previous.forwardNextPageToken,
      });
};

export const forwardSearchExhausted = (response: Response): boolean =>
  response.failures.length === 0 &&
  response.accountFailures.length === 0 &&
  response.pageInfo.every(
    (page) => !page.forwardHasMore && page.forwardNextPageToken === undefined
  );

export const continuedSearchFailures = (
  previous: readonly CalendarRefValue[],
  response: Response,
  continuation: Continuation,
  direction: "forward" | "reverse" = "forward"
): readonly CalendarRefValue[] => {
  const failures = new Map(previous.map((ref) => [refKey(ref), ref]));

  for (const target of continuation.pages) {
    failures.delete(refKey(target));
  }

  for (const failure of response.failures) {
    const target = continuation.pages.find(
      (page) => refKey(page) === refKey(failure)
    );

    if (
      target !== undefined &&
      (direction === "forward"
        ? SearchPageTarget.guards.Forward(target)
        : SearchPageTarget.guards.Reverse(target))
    ) {
      failures.set(refKey(failure), {
        accountId: failure.accountId,
        calendarId: failure.calendarId,
      });
    }
  }

  return [...failures.values()];
};

export const matchingSearchWindow = (
  previous: Response,
  page: Response,
  continuation: Continuation
): boolean =>
  previous.window.boundary === continuation.window.boundary &&
  previous.window.endExclusive === continuation.window.endExclusive &&
  page.window.boundary === continuation.window.boundary &&
  page.window.endExclusive === continuation.window.endExclusive &&
  previous.window.historyStart === continuation.window.historyStart &&
  page.window.historyStart === continuation.window.historyStart;

export const mergeSearchPage = (
  previous: Response,
  page: Response,
  continuation: Continuation
): Response => {
  const requested = new Set(continuation.pages.map(refKey));

  const requestedAccounts = new Set(
    continuation.pages.map((target) => target.accountId)
  );

  const pages = new Map(previous.pageInfo.map((item) => [refKey(item), item]));

  for (const incoming of page.pageInfo) {
    const before = pages.get(refKey(incoming));

    const target = continuation.pages.find(
      (item) => refKey(item) === refKey(incoming)
    );

    if (target === undefined) {
      continue;
    }

    let merged = incoming;

    if (SearchPageTarget.guards.Reverse(target)) {
      merged = {
        ...incoming,
        forwardHasMore: before?.forwardHasMore ?? false,
        forwardNextPageToken: before?.forwardNextPageToken,
      };
    } else if (SearchPageTarget.guards.Forward(target)) {
      merged = {
        ...incoming,
        olderCursor: before?.olderCursor,
        olderHasMore: before?.olderHasMore,
      };
    }

    pages.set(refKey(incoming), merged);
  }

  const accounts = new Map(
    [
      ...previous.accountFailures.filter(
        (failure) => !requestedAccounts.has(failure.accountId)
      ),
      ...page.accountFailures,
    ].map((failure) => [failure.accountId, failure])
  );

  return {
    accountFailures: [...accounts.values()],
    failures: [
      ...previous.failures.filter((failure) => !requested.has(refKey(failure))),
      ...page.failures,
    ],
    pageInfo: [...pages.values()],
    results: orderSearchResults([...previous.results, ...page.results]),
    window: continuation.window,
  };
};
