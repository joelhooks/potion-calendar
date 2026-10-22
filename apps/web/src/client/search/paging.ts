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
  continuation: Continuation
): readonly CalendarRefValue[] => {
  const failures = new Map(previous.map((ref) => [refKey(ref), ref]));

  for (const target of continuation.pages) {
    failures.delete(refKey(target));
  }

  for (const failure of response.failures) {
    const target = continuation.pages.find(
      (page) => refKey(page) === refKey(failure)
    );

    if (target !== undefined && SearchPageTarget.guards.Forward(target)) {
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
  page.window.endExclusive === continuation.window.endExclusive;

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

    pages.set(refKey(incoming), {
      ...incoming,
      forwardNextPageToken: incoming.forwardNextPageToken,
      olderHasMore: incoming.olderHasMore ?? before?.olderHasMore,
    });
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
