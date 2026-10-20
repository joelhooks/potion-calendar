import {
  CalendarFailure,
  SearchEventsInput,
  SearchEventsOutput,
} from "@calendar/calendar/contracts";
import { defineContract } from "@calendar/capability/contract";
import { Schema } from "effect";

export const SearchAccountFailure = Schema.Struct({
  accountId: Schema.String,
  failure: CalendarFailure,
});

export class SearchInventoryUnavailable extends Schema.TaggedError<SearchInventoryUnavailable>()(
  "SearchInventoryUnavailable",
  {
    accountFailures: Schema.Array(SearchAccountFailure),
    reason: Schema.Literals(["noAccounts", "allInventoriesFailed"]),
  }
) {}

export const SearchRequest = Schema.Struct({
  calendars: Schema.optionalKey(Schema.Never),
  query: SearchEventsInput.fields.query,
  timeZone: SearchEventsInput.fields.timeZone,
  weekStartsOn: SearchEventsInput.fields.weekStartsOn,
});

export const SearchResponse = Schema.Struct({
  ...SearchEventsOutput.fields,
  accountFailures: Schema.Array(SearchAccountFailure),
});

export const SearchRequestFailure = Schema.Union([
  CalendarFailure,
  SearchInventoryUnavailable,
]);

export const searchEventsContract = defineContract("searchEvents", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Search the signed-in person's full server-built calendar inventory. Calendar selection and metadata are not accepted from the browser. Account inventory failures and calendar search failures remain explicit.",
  failure: SearchRequestFailure,
  input: SearchRequest,
  output: SearchResponse,
});
