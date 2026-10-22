import { Cause, Clock, Effect, Exit, Layer, Ref, Schema } from "effect";

import { CalendarService } from "../src/calendar.js";
import { CalendarChanged, CalendarChanges } from "../src/changes.js";
import type { CalendarChangedValue } from "../src/changes.js";
import { ListEventsOutput } from "../src/contracts.js";
import { GoogleCalendarClient } from "../src/google.js";
import { CacheSnapshot, CalendarStore } from "../src/store.js";
import { SyncResult } from "../src/sync-result.js";
import { CalendarSync, syncCalendar } from "../src/sync.js";
import { GoogleRequest } from "../src/transport.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

export const StoreCommand = Schema.Literals([
  "read",
  "emptySync",
  "changedSync",
  "write",
]);

export const StoreCommands = Schema.Array(StoreCommand).check(
  Schema.isMaxLength(20)
);

export type StoreCommandValue = typeof StoreCommand.Type;

export const StoreHistoryInput = Schema.Struct({
  clockMilliseconds: Schema.Finite,
  commands: StoreCommands,
});

export const StoreHistoryInputJson = Schema.fromJsonString(StoreHistoryInput);

const ObservedStoreCommand = Schema.TaggedStruct("Observed", {
  clockMilliseconds: Schema.Finite,
  command: StoreCommand,
  listed: Schema.optional(ListEventsOutput),
  pending: Schema.Array(
    Schema.Struct({
      body: Schema.String,
      retryAfterMs: Schema.Finite,
      status: Schema.Finite,
    })
  ),
  published: Schema.Array(CalendarChanged),
  requests: Schema.Array(GoogleRequest),
  snapshot: CacheSnapshot,
  synced: Schema.optional(SyncResult),
});

const FailedStoreCommand = Schema.TaggedStruct("Failed", {
  cause: Schema.String,
  command: StoreCommand,
  phase: Schema.Literals(["command", "observation"]),
});

export const StoreObservation = Schema.Union([
  ObservedStoreCommand,
  FailedStoreCommand,
]);

export const StoreObservations = Schema.Array(StoreObservation);

export const StoreObservationsJson = Schema.fromJsonString(StoreObservations);

export type StoreObservationValue = typeof StoreObservation.Type;

const range = {
  end: "2026-04-01T00:00:00-07:00",
  start: "2026-03-01T00:00:00-08:00",
};

export const runStoreHistory = Effect.fn("test.runStoreHistory")(
  function* runStoreHistory<E, R>(
    commands: readonly StoreCommandValue[],
    makeStoreLayer: () => Layer.Layer<CalendarStore, E, R>
  ) {
    const fake = yield* fakeGoogle();
    const published = yield* Ref.make<readonly CalendarChangedValue[]>([]);

    const signals = Layer.succeed(CalendarChanges, {
      publish: (change) =>
        Ref.update(published, (previous) => [...previous, change]),
    });

    const base = Layer.mergeAll(
      GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer)),
      makeStoreLayer(),
      fake.layer,
      signals
    );

    const layer = Layer.merge(CalendarService.layer, CalendarSync.layer).pipe(
      Layer.provideMerge(base)
    );

    return yield* Effect.gen(function* observeHistory() {
      const calendar = yield* CalendarService;
      const store = yield* CalendarStore;
      const observations: StoreObservationValue[] = [];
      let cached = false;

      const executeCommand = Effect.fnUntraced(function* executeCommand(
        index: number,
        command: StoreCommandValue
      ) {
        if (command === "read") {
          if (!cached) {
            yield* Ref.set(fake.pending, [
              response(200, { items: [timedEvent("event")] }),
            ]);
          }

          const listed = yield* calendar.listEvents({
            calendars: [ref],
            range,
          });

          cached = true;

          return { listed, synced: undefined };
        }

        if (command === "write") {
          yield* Ref.set(fake.pending, [
            response(200, timedEvent("event")),
            response(200, timedEvent("event", "Edited")),
          ]);
          yield* calendar.updateEvent({
            ...ref,
            changes: { title: "Edited" },
            eventId: "event",
            scope: "single",
          });
          cached = false;

          return { listed: undefined, synced: undefined };
        }

        yield* Ref.set(fake.pending, [
          response(200, {
            items: command === "emptySync" ? [] : [timedEvent("event")],
            nextSyncToken: `cursor-${index}`,
          }),
        ]);
        const synced = yield* syncCalendar(ref);

        if (command === "changedSync") {
          cached = false;
        }

        return { listed: undefined, synced };
      });

      for (const [index, command] of commands.entries()) {
        const outcome = yield* executeCommand(index, command).pipe(Effect.exit);

        if (Exit.isFailure(outcome)) {
          observations.push(
            FailedStoreCommand.make({
              cause: Cause.pretty(outcome.cause),
              command,
              phase: "command",
            })
          );
          break;
        }

        const observation = yield* Effect.gen(function* collectObservation() {
          return {
            clockMilliseconds: yield* Clock.currentTimeMillis,
            listed: outcome.value.listed,
            pending: yield* Ref.get(fake.pending),
            published: yield* Ref.get(published),
            requests: yield* Ref.get(fake.requests),
            snapshot: yield* store.read(ref),
            synced: outcome.value.synced,
          };
        }).pipe(Effect.exit);

        if (Exit.isFailure(observation)) {
          observations.push(
            FailedStoreCommand.make({
              cause: Cause.pretty(observation.cause),
              command,
              phase: "observation",
            })
          );
          break;
        }

        observations.push(
          ObservedStoreCommand.make({
            command,
            ...observation.value,
          })
        );
      }

      return observations;
    }).pipe(Effect.provide(layer));
  }
);
