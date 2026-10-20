import type {
  CalendarEventValue,
  CreateEventInput,
  DeleteEventInput,
  EventRefValue,
  MoveEventInput,
  MoveAndRetimeSeriesInput,
  RsvpInput,
  UpdateEventInput,
} from "@calendar/calendar/contracts";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient } from "effect/rpc";

import { browserGroup, protocol } from "../rpc.js";
import { DeletionWriter } from "./delete-actor.js";
import {
  MutationFailure,
  MutationFeatureUnavailable,
  MutationTransportFailure,
} from "./failure.js";
import type { MutationFailureValue } from "./failure.js";
import { keepaliveFetch } from "./keepalive-fetch.js";
import type { MoveSupport } from "./move-support.js";

const makeClient = RpcClient.make(browserGroup);

type BrowserClient = Effect.Success<typeof makeClient>;

const decodeMutationFailure = (cause: unknown): MutationFailureValue => {
  const known = Schema.decodeUnknownOption(MutationFailure)(cause);

  return Option.isSome(known)
    ? known.value
    : new MutationTransportFailure({
        message:
          "Calendar could not confirm the change. Refresh to check Google before retrying.",
      });
};

const withClient = <A, E>(
  run: (client: BrowserClient) => Effect.Effect<A, E>,
  keepalive = false
): Effect.Effect<A, MutationFailureValue> =>
  Effect.gen(function* calendarRequest() {
    const fetcher = yield* FetchHttpClient.Fetch;

    const request = makeClient.pipe(
      Effect.flatMap(run),
      Effect.provide(protocol),
      Effect.scoped,
      Effect.provideService(FetchHttpClient.RequestInit, { keepalive }),
      Effect.mapError(decodeMutationFailure)
    );

    return yield* keepalive
      ? request.pipe(
          Effect.provideService(FetchHttpClient.Fetch, keepaliveFetch(fetcher))
        )
      : request;
  });

export class CalendarEditingClient extends Context.Service<
  CalendarEditingClient,
  {
    readonly createEvent: (
      input: typeof CreateEventInput.Type
    ) => Effect.Effect<CalendarEventValue, MutationFailureValue>;
    readonly deleteEvent: (
      input: typeof DeleteEventInput.Type,
      keepalive?: boolean
    ) => Effect.Effect<void, MutationFailureValue>;
    readonly getEvent: (
      input: EventRefValue
    ) => Effect.Effect<CalendarEventValue, MutationFailureValue>;
    readonly moveEvent: (
      input: typeof MoveEventInput.Type
    ) => Effect.Effect<CalendarEventValue, MutationFailureValue>;
    readonly moveAndRetimeSeries: (
      input: typeof MoveAndRetimeSeriesInput.Type
    ) => Effect.Effect<CalendarEventValue, MutationFailureValue>;
    readonly moveSupport: typeof MoveSupport.Type;
    readonly rsvp: (
      input: typeof RsvpInput.Type
    ) => Effect.Effect<CalendarEventValue, MutationFailureValue>;
    readonly updateEvent: (
      input: typeof UpdateEventInput.Type
    ) => Effect.Effect<CalendarEventValue, MutationFailureValue>;
  }
>()("@calendar/web/CalendarEditingClient") {
  static readonly layer = (moveSupport: typeof MoveSupport.Type) =>
    Layer.succeed(
      CalendarEditingClient,
      CalendarEditingClient.of({
        createEvent: Effect.fn("CalendarEditingClient.createEvent")(
          (input: typeof CreateEventInput.Type) =>
            withClient((client) => client.createEvent(input))
        ),
        deleteEvent: Effect.fn("CalendarEditingClient.deleteEvent")(
          (input: typeof DeleteEventInput.Type, keepalive = false) =>
            withClient((client) => client.deleteEvent(input), keepalive)
        ),
        getEvent: Effect.fn("CalendarEditingClient.getEvent")(
          (input: EventRefValue) =>
            withClient((client) => client.getEvent(input))
        ),
        moveAndRetimeSeries: Effect.fn(
          "CalendarEditingClient.moveAndRetimeSeries"
        )((input: typeof MoveAndRetimeSeriesInput.Type) =>
          withClient((client) => client.moveAndRetimeSeries(input))
        ),
        moveEvent: Effect.fn("CalendarEditingClient.moveEvent")(
          (input: typeof MoveEventInput.Type) =>
            moveSupport === "notAvailable"
              ? Effect.fail(
                  new MutationFeatureUnavailable({
                    feature: "calendarMove",
                    message:
                      "Moving calendars is not available until the server update is installed.",
                  })
                )
              : withClient((client) => client.moveEvent(input))
        ),
        moveSupport,
        rsvp: Effect.fn("CalendarEditingClient.rsvp")(
          (input: typeof RsvpInput.Type) =>
            withClient((client) => client.rsvp(input))
        ),
        updateEvent: Effect.fn("CalendarEditingClient.updateEvent")(
          (input: typeof UpdateEventInput.Type) =>
            withClient((client) => client.updateEvent(input))
        ),
      })
    );
}

export const deletionWriterLayer = Layer.effect(
  DeletionWriter,
  CalendarEditingClient.pipe(
    Effect.map((writer) =>
      DeletionWriter.of({
        commit: (input) => writer.deleteEvent(input.request, input.keepalive),
      })
    )
  )
);
