import type {
  CalendarEvent,
  ReadNeighborOccurrenceInput,
} from "@calendar/calendar/contracts";
import { CalendarReadFailure } from "@calendar/calendar/contracts";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { RpcClient } from "effect/rpc";

import { browserGroup, protocol } from "../rpc.js";
import { OccurrenceProblem } from "./model.js";

export class OccurrenceClient extends Context.Service<
  OccurrenceClient,
  {
    readonly read: (
      request: typeof ReadNeighborOccurrenceInput.Type
    ) => Effect.Effect<
      typeof CalendarEvent.Type | null,
      typeof OccurrenceProblem.Type
    >;
  }
>()("@calendar/web/OccurrenceClient") {
  static readonly layer = Layer.succeed(
    OccurrenceClient,
    OccurrenceClient.of({
      read: Effect.fn("OccurrenceClient.read")(
        (request: typeof ReadNeighborOccurrenceInput.Type) =>
          RpcClient.make(browserGroup).pipe(
            Effect.flatMap((client) => client.readNeighborOccurrence(request)),
            Effect.provide(protocol),
            Effect.scoped,
            Effect.mapError((cause): typeof OccurrenceProblem.Type => {
              const known =
                Schema.decodeUnknownOption(CalendarReadFailure)(cause);

              return Option.isSome(known)
                ? OccurrenceProblem.cases.Request.make({ failure: known.value })
                : OccurrenceProblem.cases.Transport.make({ cause });
            })
          )
      ),
    })
  );
}
