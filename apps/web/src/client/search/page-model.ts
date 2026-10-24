import { SearchContinuation } from "@calendar/calendar/contracts";
import { Schema } from "effect";

import { SearchResponse } from "../../search-contract.js";
import { SearchProblem, SearchTask } from "./model.js";

export const SearchDirection = Schema.Literals(["forward", "reverse"]);

export const SearchPageTask = Schema.Struct({
  continuation: SearchContinuation,
  task: SearchTask,
});

export const SearchPageNotice = Schema.TaggedUnion({
  Failed: {
    direction: SearchDirection,
    page: SearchPageTask,
    problem: SearchProblem,
  },
  Loading: { direction: SearchDirection, page: SearchPageTask },
  Ready: {
    direction: SearchDirection,
    page: SearchPageTask,
    response: SearchResponse,
  },
});

export const SearchScrollAnchor = Schema.Struct({
  key: Schema.String,
  offset: Schema.Finite,
  position: Schema.Finite,
});
