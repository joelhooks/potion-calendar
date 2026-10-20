import { Effect, Option, Stream } from "effect";
import { RpcClient } from "effect/rpc";

import { readFailure } from "../calendar-state.js";
import { Message } from "../message.js";
import { browserGroup, protocol } from "../rpc.js";
import type { UpcomingQueryValue } from "./model.js";

export const readUpcoming = (query: UpcomingQueryValue) =>
  Effect.gen(function* upcomingRead() {
    const client = yield* RpcClient.make(browserGroup);

    const result = yield* client.listEvents({
      calendars: query.calendars,
      range: query.range,
    });

    return Message.ReceivedUpcoming({
      personId: query.personId,
      request: query.request,
      result,
    });
  }).pipe(
    Effect.provide(protocol),
    Effect.scoped,
    Effect.match({
      onFailure: (cause) =>
        Message.FailedUpcoming({
          failure: readFailure(cause),
          personId: query.personId,
          request: query.request,
        }),
      onSuccess: (message) => message,
    })
  );

export const upcomingStream = (query: Option.Option<UpcomingQueryValue>) =>
  Option.match(query, {
    onNone: () => Stream.empty,
    onSome: (current) => Stream.fromEffect(readUpcoming(current)),
  });
