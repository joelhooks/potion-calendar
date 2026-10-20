import { Effect, Layer, Ref, Schema } from "effect";

import { Provider } from "./errors.js";
import { CalendarEvent } from "./model.js";
import type {
  CalendarEventValue,
  CalendarRefValue,
  RangeValue,
} from "./model.js";
import { CalendarStore } from "./store.js";
import type { CacheSnapshotValue } from "./store.js";

const keyFor = (ref: CalendarRefValue) =>
  JSON.stringify([ref.accountId, ref.calendarId]);

const rangeKey = (range: RangeValue) =>
  JSON.stringify([range.start, range.end]);

const empty: CacheSnapshotValue = { revision: 0, version: 0 };

interface Entry {
  readonly snapshot: CacheSnapshotValue;
  readonly ranges: ReadonlyMap<string, readonly CalendarEventValue[]>;
}

const emptyEntry: Entry = { ranges: new Map(), snapshot: empty };

const validateEvents = Effect.fn("validateCachedEvents")(
  function* validateEvents(
    ref: CalendarRefValue,
    events: readonly CalendarEventValue[]
  ) {
    const valid = yield* Schema.decodeEffect(Schema.Array(CalendarEvent))(
      events
    ).pipe(
      Effect.mapError(
        () =>
          new Provider({
            message: "Refuse invalid cached events",
            operation: "cache",
            status: 0,
          })
      )
    );

    if (
      valid.some(
        (event) =>
          event.accountId !== ref.accountId ||
          event.calendarId !== ref.calendarId
      )
    ) {
      return yield* new Provider({
        message: "Refuse cross-calendar cached events",
        operation: "cache",
        status: 0,
      });
    }

    return valid;
  }
);

export const memoryCalendarStore = Layer.effect(
  CalendarStore,
  Effect.gen(function* memoryCalendarStore() {
    const state = yield* Ref.make<ReadonlyMap<string, Entry>>(new Map());

    return CalendarStore.of({
      cacheRange: Effect.fn("CalendarStore.cacheRange")(
        function* cacheRange(ref, range, version, events) {
          const valid = yield* validateEvents(ref, events);

          return yield* Ref.modify(state, (entries) => {
            const key = keyFor(ref);
            const previous = entries.get(key) ?? emptyEntry;

            if (previous.snapshot.version !== version) {
              return [false, entries];
            }

            return [
              true,
              new Map(entries).set(key, {
                ranges: new Map(previous.ranges).set(rangeKey(range), valid),
                snapshot: previous.snapshot,
              }),
            ];
          });
        }
      ),
      clear: (ref, expectedRevision) =>
        Ref.modify(state, (entries) => {
          const key = keyFor(ref);
          const previous = (entries.get(key) ?? emptyEntry).snapshot;

          if (previous.revision !== expectedRevision) {
            return [false, entries];
          }

          return [
            true,
            new Map(entries).set(key, {
              ranges: new Map(),
              snapshot: {
                revision: previous.revision + 1,
                version: previous.version + 1,
              },
            }),
          ];
        }),
      commit: Effect.fn("CalendarStore.commit")(
        function* commit(ref, expectedRevision, changed, cursor) {
          return yield* Ref.modify(state, (entries) => {
            const key = keyFor(ref);
            const entry = entries.get(key) ?? emptyEntry;
            const previous = entry.snapshot;

            if (previous.revision !== expectedRevision) {
              return [false, entries];
            }

            const hasChanges = changed > 0;

            return [
              true,
              new Map(entries).set(key, {
                ranges: hasChanges ? new Map() : entry.ranges,
                snapshot: {
                  cursor,
                  revision: previous.revision + 1,
                  version: previous.version + (hasChanges ? 1 : 0),
                },
              }),
            ];
          });
        }
      ),
      invalidate: (ref) =>
        Ref.modify(state, (entries) => {
          const key = keyFor(ref);
          const previous = (entries.get(key) ?? emptyEntry).snapshot;
          const version = previous.version + 1;

          return [
            version,
            new Map(entries).set(key, {
              ranges: new Map(),
              snapshot: {
                ...previous,
                revision: previous.revision + 1,
                version,
              },
            }),
          ];
        }),
      read: (ref) =>
        Ref.get(state).pipe(
          Effect.map(
            (entries) => (entries.get(keyFor(ref)) ?? emptyEntry).snapshot
          )
        ),
      readRange: (ref, range, version) =>
        Ref.get(state).pipe(
          Effect.map((entries) => {
            const entry = entries.get(keyFor(ref)) ?? emptyEntry;

            return entry.snapshot.version === version
              ? entry.ranges.get(rangeKey(range))
              : undefined;
          })
        ),
    });
  })
);
