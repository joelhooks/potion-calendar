import { CalendarRef } from "@calendar/calendar/contracts";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { RpcClient } from "effect/rpc";

import { midnightInZone } from "../../layout/navigation.js";
import type { SearchRequest, SearchResponse } from "../../search-contract.js";
import { SearchRequestFailure } from "../../search-contract.js";
import { browserGroup, protocol } from "../rpc.js";
import { SearchProblem } from "./model.js";

export const SearchPrefetch = Schema.Struct({
  calendar: CalendarRef,
  day: Schema.Int,
  timeZone: Schema.NonEmptyString,
});

const makeClient = RpcClient.make(browserGroup);

type BrowserClient = Effect.Success<typeof makeClient>;

const withClient = <A, E>(
  run: (client: BrowserClient) => Effect.Effect<A, E>
) =>
  makeClient.pipe(
    Effect.flatMap(run),
    Effect.provide(protocol),
    Effect.scoped,
    Effect.mapError((failure): typeof SearchProblem.Type => {
      const known = Schema.decodeUnknownOption(SearchRequestFailure)(failure);

      return Option.isSome(known)
        ? SearchProblem.cases.Request.make({ failure: known.value })
        : SearchProblem.cases.Transport.make({
            cause: failure,
            message:
              "Could not load calendar data. Check your connection and try again.",
          });
    })
  );

export class CalendarSearchClient extends Context.Service<
  CalendarSearchClient,
  {
    readonly search: (
      request: typeof SearchRequest.Type
    ) => Effect.Effect<typeof SearchResponse.Type, typeof SearchProblem.Type>;
    readonly prefetch: (
      request: typeof SearchPrefetch.Type
    ) => Effect.Effect<void, typeof SearchProblem.Type>;
  }
>()("@calendar/web/CalendarSearchClient") {
  static readonly layer = Layer.succeed(
    CalendarSearchClient,
    CalendarSearchClient.of({
      prefetch: Effect.fn("CalendarSearchClient.prefetch")(
        (request: typeof SearchPrefetch.Type) =>
          withClient((client) =>
            client.listEvents({
              calendars: [request.calendar],
              range: {
                end: midnightInZone(request.day + 1, request.timeZone),
                start: midnightInZone(request.day, request.timeZone),
              },
            })
          ).pipe(Effect.asVoid)
      ),
      search: Effect.fn("CalendarSearchClient.search")(
        (request: typeof SearchRequest.Type) =>
          withClient((client) => client.searchEvents(request))
      ),
    })
  );
}
