import {
  CalendarRef,
  Range,
  listEventsContract,
  syncNowContract,
} from "@calendar/calendar/contracts";
import { toRpcGroup } from "@calendar/capability/rpc-group";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Command } from "foldkit";

import { readFailure } from "../calendar-state.js";
import { Message } from "../message.js";

const refreshGroup = toRpcGroup([syncNowContract, listEventsContract]).group;

const protocol = RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(FetchHttpClient.layer)
);

export const RefreshEvents = Command.define("RefreshEvents", {
  args: {
    accountId: Schema.String,
    calendars: Schema.Array(CalendarRef),
    range: Range,
    request: Schema.Int,
  },
  execute: ({ accountId, calendars, range, request }) =>
    Effect.gen(function* refreshEvents() {
      const client = yield* RpcClient.make(refreshGroup);

      for (const calendar of calendars) {
        yield* client.syncNow(calendar);
      }

      return Message.ReceivedEvents({
        accountId,
        request,
        result: yield* client.listEvents({ calendars, range }),
      });
    }).pipe(
      Effect.provide(protocol),
      Effect.scoped,
      Effect.match({
        onFailure: (error) =>
          Message.FailedEvents({
            accountId,
            failure: readFailure(error),
            request,
          }),
        onSuccess: (message) => message,
      })
    ),
  messages: [Message.ReceivedEvents, Message.FailedEvents],
});
