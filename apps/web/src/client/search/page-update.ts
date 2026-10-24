import {
  SearchContinuation,
  SearchPageTarget,
} from "@calendar/calendar/contracts";
import type { CalendarRefValue } from "@calendar/calendar/contracts";
import { Option, Predicate, Schema } from "effect";
import type { Update } from "foldkit";

import type { AppModel } from "../app.js";
import type { AppMessage } from "../message.js";
import type { CalendarSearchClient } from "./client.js";
import {
  CaptureSearchPage,
  DispatchSearchPage,
  RestoreSearchAnchor,
} from "./commands.js";
import { SearchProblem } from "./model.js";
import type { SearchPageFailures } from "./model.js";
import { SearchPageNotice } from "./page-model.js";
import type { SearchScrollAnchor } from "./page-model.js";
import {
  continuedSearchFailures,
  matchingSearchWindow,
  mergeSearchPage,
  reverseSearchTargets,
} from "./paging.js";
import type { SearchRuntime } from "./runtime.js";
import { searchQueryTask, searchScope, searchTaskScope } from "./source.js";

type PageResult = Update.Return<
  AppModel,
  AppMessage,
  CalendarSearchClient | SearchRuntime
>;

const sameContinuation = Schema.toEquivalence(SearchContinuation);

const refKey = (ref: {
  readonly accountId: string;
  readonly calendarId: string;
}) => JSON.stringify([ref.accountId, ref.calendarId]);

const pageCurrent = (model: AppModel, notice: typeof SearchPageNotice.Type) => {
  const { task, continuation } = notice.page;

  const requested =
    notice.direction === "forward"
      ? model.search.continuation
      : model.search.reverseContinuation;

  return (
    Predicate.isTagged(model.route, "Search") &&
    Option.contains(model.person, task.personId) &&
    task.revision === model.search.revision &&
    searchTaskScope(task) === searchScope(model) &&
    model.search.responseScope === searchScope(model) &&
    requested !== undefined &&
    sameContinuation(requested, continuation)
  );
};

const settledFailures = (
  previous: Option.Option<typeof SearchPageFailures.Type>,
  notice: typeof SearchPageNotice.cases.Ready.Type
): typeof SearchPageFailures.Type => {
  const pages = new Set(notice.page.continuation.pages.map(refKey));

  const accounts = new Set(
    notice.page.continuation.pages.map((page) => page.accountId)
  );

  return {
    accountFailures: [
      ...Option.getOrElse(previous, () => ({
        accountFailures: [],
        failures: [],
      })).accountFailures.filter((failure) => !accounts.has(failure.accountId)),
      ...notice.response.accountFailures,
    ],
    failures: [
      ...Option.getOrElse(previous, () => ({
        accountFailures: [],
        failures: [],
      })).failures.filter((failure) => !pages.has(refKey(failure))),
      ...notice.response.failures,
    ],
  };
};

export const receiveSearchPage = (
  model: AppModel,
  notice: typeof SearchPageNotice.Type
): PageResult => {
  if (!pageCurrent(model, notice)) {
    return { model };
  }

  if (Predicate.isTagged(notice, "Ready")) {
    return { commands: [CaptureSearchPage({ notice })], model };
  }

  if (Predicate.isTagged(notice, "Loading")) {
    return { model };
  }

  return {
    model: {
      ...model,
      search:
        notice.direction === "forward"
          ? {
              ...model.search,
              phase: "MoreFailed",
              problem: Option.some(notice.problem),
            }
          : {
              ...model.search,
              reversePhase: "MoreFailed",
              reverseProblem: Option.some(notice.problem),
            },
    },
  };
};

export const applySearchPage = (
  model: AppModel,
  notice: typeof SearchPageNotice.cases.Ready.Type,
  anchor: Option.Option<typeof SearchScrollAnchor.Type>
): PageResult => {
  const loading =
    notice.direction === "forward"
      ? model.search.phase === "LoadingMore"
      : model.search.reversePhase === "LoadingMore";

  if (
    !pageCurrent(model, notice) ||
    !loading ||
    Option.isNone(model.search.response)
  ) {
    return { model };
  }

  if (
    !matchingSearchWindow(
      model.search.response.value,
      notice.response,
      notice.page.continuation
    )
  ) {
    const failure = SearchProblem.cases.Transport.make({
      message: "The search window changed. Search again to continue.",
    });

    return receiveSearchPage(
      model,
      SearchPageNotice.cases.Failed.make({
        direction: notice.direction,
        page: notice.page,
        problem: failure,
      })
    );
  }

  const forward = notice.direction === "forward";

  const ledger = settledFailures(
    forward ? model.search.forwardFailures : model.search.reverseFailures,
    notice
  );

  const other = Option.getOrElse(
    forward ? model.search.reverseFailures : model.search.forwardFailures,
    () => ({ accountFailures: [], failures: [] })
  );

  const merged = mergeSearchPage(
    model.search.response.value,
    notice.response,
    notice.page.continuation
  );

  const failures = new Map(
    [...merged.failures, ...ledger.failures, ...other.failures].map(
      (failure) => [refKey(failure), failure]
    )
  );

  const accounts = new Map(
    [
      ...merged.accountFailures,
      ...ledger.accountFailures,
      ...other.accountFailures,
    ].map((failure) => [failure.accountId, failure])
  );

  return {
    commands: [RestoreSearchAnchor({ anchor, task: notice.page.task })],
    model: {
      ...model,
      search: {
        ...model.search,
        ...(forward
          ? {
              continuationFailures: continuedSearchFailures(
                model.search.continuationFailures,
                notice.response,
                notice.page.continuation
              ),
              forwardFailures: Option.some(ledger),
              phase: "Ready",
              problem: Option.none(),
            }
          : {
              reverseFailures: Option.some(ledger),
              reversePhase: "Ready",
              reverseProblem: Option.none(),
            }),
        response: Option.some({
          ...merged,
          accountFailures: [...accounts.values()],
          failures: [...failures.values()],
        }),
      },
    },
  };
};

const retryOlderTargets = (model: AppModel, target?: CalendarRefValue) => {
  const { search } = model;

  if (search.reversePhase === "MoreFailed") {
    return (search.reverseContinuation?.pages ?? []).filter(
      (page) => target === undefined || refKey(page) === refKey(target)
    );
  }

  if (Option.isNone(search.response)) {
    return [];
  }

  const ledger = Option.getOrElse(search.reverseFailures, () => ({
    accountFailures: [],
    failures: [],
  }));

  const failed = new Set(ledger.failures.map(refKey));

  const accounts = new Set(
    ledger.accountFailures.map((failure) => failure.accountId)
  );

  return search.response.value.pageInfo.flatMap((page) => {
    const selected = target === undefined || refKey(page) === refKey(target);
    const refused = failed.has(refKey(page)) || accounts.has(page.accountId);

    if (!selected || !refused || page.olderCursor === undefined) {
      return [];
    }

    return [
      SearchPageTarget.cases.Reverse.make({
        accountId: page.accountId,
        calendarId: page.calendarId,
        ...page.olderCursor,
      }),
    ];
  });
};

export const loadOlderSearch = (
  model: AppModel,
  retry = false,
  target?: CalendarRefValue
): PageResult => {
  const task = searchQueryTask(model);
  const { search } = model;

  if (
    Option.isNone(task) ||
    Option.isNone(search.response) ||
    search.responseScope !== searchScope(model) ||
    (search.phase !== "Ready" &&
      search.phase !== "LoadingMore" &&
      search.phase !== "MoreFailed") ||
    search.reversePhase === "LoadingMore" ||
    (search.reversePhase === "MoreFailed" && !retry)
  ) {
    return { model };
  }

  const other = Option.getOrElse(search.forwardFailures, () => ({
    accountFailures: [],
    failures: [],
  }));

  const ownResponse = {
    ...search.response.value,
    accountFailures: search.response.value.accountFailures.filter(
      (failure) =>
        !other.accountFailures.some(
          (item) => item.accountId === failure.accountId
        )
    ),
    failures: retry
      ? []
      : search.response.value.failures.filter(
          (failure) =>
            !other.failures.some((item) => refKey(item) === refKey(failure))
        ),
  };

  const pages = retry
    ? retryOlderTargets(model, target)
    : reverseSearchTargets(ownResponse);

  if (pages.length === 0) {
    return { model };
  }

  const continuation = { pages, window: search.response.value.window };

  return {
    commands: [
      DispatchSearchPage({
        direction: "reverse",
        page: { continuation, task: task.value },
      }),
    ],
    model: {
      ...model,
      search: {
        ...search,
        reverseContinuation: continuation,
        reversePhase: "LoadingMore",
        reverseProblem: Option.none(),
      },
    },
  };
};
