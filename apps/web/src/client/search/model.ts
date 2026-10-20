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
  Ready: { response: SearchResponse, task: SearchTask },
  Searching: { task: SearchTask },
});

export const SearchUi = Schema.Struct({
  menu: Schema.Option(Schema.Struct({ key: Schema.String })),
  phase: Schema.Literals([
    "Idle",
    "Debouncing",
    "Searching",
    "Ready",
    "Failed",
  ]),
  problem: Schema.Option(SearchProblem),
  response: Schema.Option(SearchResponse),
  revision: Schema.Int,
  scroll: Schema.Option(Schema.Finite),
  text: Schema.String,
  urlQuery: Schema.String,
});

export const initialSearch = (revision = 0): typeof SearchUi.Type => ({
  menu: Option.none(),
  phase: "Idle",
  problem: Option.none(),
  response: Option.none(),
  revision,
  scroll: Option.none(),
  text: "",
  urlQuery: "",
});
