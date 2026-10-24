import { CalendarRef, SearchContinuation } from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";

import {
  SearchRequest,
  SearchRequestFailure,
  SearchResponse,
} from "../../search-contract.js";

export const SearchTask = Schema.Struct({
  personId: Schema.String,
  request: SearchRequest,
  revision: Schema.Int,
});

export const SearchProblem = Schema.TaggedUnion({
  Request: { failure: SearchRequestFailure },
  Transport: {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
  },
});

export const SearchNotice = Schema.TaggedUnion({
  Debouncing: { task: SearchTask },
  Failed: { problem: SearchProblem, task: SearchTask },
  Idle: { task: SearchTask },
  LoadingMore: { task: SearchTask },
  Ready: { response: SearchResponse, task: SearchTask },
  Searching: { task: SearchTask },
});

export const SearchPageFailures = Schema.Struct({
  accountFailures: SearchResponse.fields.accountFailures,
  failures: SearchResponse.fields.failures,
});

export const SearchUi = Schema.Struct({
  continuation: Schema.optional(SearchContinuation),
  continuationFailures: Schema.Array(CalendarRef),
  forwardFailures: Schema.Option(SearchPageFailures),
  menu: Schema.Option(Schema.Struct({ key: Schema.String })),
  phase: Schema.Literals([
    "Idle",
    "Debouncing",
    "Searching",
    "LoadingMore",
    "MoreFailed",
    "Ready",
    "Failed",
  ]),
  problem: Schema.Option(SearchProblem),
  response: Schema.Option(SearchResponse),
  responseScope: Schema.optional(Schema.String),
  reverseContinuation: Schema.optional(SearchContinuation),
  reverseFailures: Schema.Option(SearchPageFailures),
  reversePhase: Schema.Literals(["Idle", "LoadingMore", "Ready", "MoreFailed"]),
  reverseProblem: Schema.Option(SearchProblem),
  revision: Schema.Int,
  scroll: Schema.Option(Schema.Finite),
  text: Schema.String,
  urlQuery: Schema.String,
});

export const resetSearchPaging = (): Pick<
  typeof SearchUi.Type,
  | "continuation"
  | "forwardFailures"
  | "reverseContinuation"
  | "reverseFailures"
  | "reversePhase"
  | "reverseProblem"
> => ({
  continuation: undefined,
  forwardFailures: Option.none(),
  reverseContinuation: undefined,
  reverseFailures: Option.none(),
  reversePhase: "Idle",
  reverseProblem: Option.none(),
});

export const initialSearch = (revision = 0): typeof SearchUi.Type => ({
  continuationFailures: [],
  forwardFailures: Option.none(),
  menu: Option.none(),
  phase: "Idle",
  problem: Option.none(),
  response: Option.none(),
  reverseFailures: Option.none(),
  reversePhase: "Idle",
  reverseProblem: Option.none(),
  revision,
  scroll: Option.none(),
  text: "",
  urlQuery: "",
});
