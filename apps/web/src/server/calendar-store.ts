import {
  CalendarEvent,
  CalendarStore,
  CacheSnapshot,
  Provider,
} from "@calendar/calendar";
import type { CalendarEventValue, CalendarRefValue } from "@calendar/calendar";
import { calendarCacheRepository } from "@calendar/database/calendar-cache";
import type { CalendarCacheError } from "@calendar/database/calendar-cache";
import { Clock, Effect, Layer, Schema } from "effect";

export const calendarRangeTtlMs = 15 * 60 * 1000;

export const calendarRangeCacheByteLimit = 1_000_000;

const ChangeCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const EventArrayJson = Schema.fromJsonString(Schema.Array(CalendarEvent));

const EventJson = Schema.fromJsonString(CalendarEvent);

const storageFailure = (error: CalendarCacheError) =>
  new Provider({
    message: "Calendar cache is unavailable",
    operation: error.operation,
    status: 0,
  });

const invalidCache = () =>
  new Provider({
    message: "Refuse invalid calendar cache data",
    operation: "cache",
    status: 0,
  });

const validateEvents = Effect.fn("validateD1CalendarEvents")(
  function* validateEvents(
    ref: CalendarRefValue,
    events: readonly CalendarEventValue[]
  ) {
    const valid = yield* Schema.decodeEffect(Schema.Array(CalendarEvent))(
      events
    ).pipe(Effect.mapError(invalidCache));

    if (
      valid.some(
        (event) =>
          event.accountId !== ref.accountId ||
          event.calendarId !== ref.calendarId
      )
    ) {
      return yield* invalidCache();
    }

    return valid;
  }
);

export const d1CalendarStore = (
  binding: Parameters<typeof calendarCacheRepository>[0],
  personId: string
) =>
  Layer.effect(
    CalendarStore,
    Effect.sync(() => {
      const repository = calendarCacheRepository(binding, personId);

      const read = Effect.fn("D1CalendarStore.read")(function* read(
        ref: CalendarRefValue
      ) {
        const row = yield* repository
          .read(ref)
          .pipe(Effect.mapError(storageFailure));

        return yield* Schema.decodeEffect(CacheSnapshot)({
          ...row,
          cursor: row.cursor ?? undefined,
        }).pipe(Effect.mapError(invalidCache));
      });

      return CalendarStore.of({
        cacheRange: Effect.fn("D1CalendarStore.cacheRange")(
          function* cacheRange(ref, range, version, events) {
            const valid = yield* validateEvents(ref, events);

            const encoded = yield* Schema.encodeEffect(EventArrayJson)(
              valid
            ).pipe(Effect.mapError(invalidCache));

            if (
              new TextEncoder().encode(encoded).byteLength >
              calendarRangeCacheByteLimit
            ) {
              return (yield* read(ref)).version === version;
            }

            const now = yield* Clock.currentTimeMillis;

            return yield* repository
              .cacheRange(
                ref,
                range.start,
                range.end,
                version,
                now + calendarRangeTtlMs,
                encoded
              )
              .pipe(Effect.mapError(storageFailure));
          }
        ),
        clear: Effect.fn("D1CalendarStore.clear")(
          function* clear(ref, expectedRevision) {
            const previous = yield* read(ref);

            if (previous.revision !== expectedRevision) {
              return false;
            }

            return yield* repository
              .compareAndSwap(ref, expectedRevision, {
                cursor: null,
                revision: expectedRevision + 1,
                version: previous.version + 1,
              })
              .pipe(Effect.mapError(storageFailure));
          }
        ),
        commit: Effect.fn("D1CalendarStore.commit")(
          function* commit(ref, expectedRevision, changed, cursor) {
            const count = yield* Schema.decodeEffect(ChangeCount)(changed).pipe(
              Effect.mapError(invalidCache)
            );

            const previous = yield* read(ref);

            if (previous.revision !== expectedRevision) {
              return false;
            }

            return yield* repository
              .compareAndSwap(ref, expectedRevision, {
                cursor,
                revision: expectedRevision + 1,
                version: previous.version + (count > 0 ? 1 : 0),
              })
              .pipe(Effect.mapError(storageFailure));
          }
        ),
        hydrateEvent: Effect.fn("D1CalendarStore.hydrateEvent")(
          function* hydrateEvent(ref, version, event) {
            yield* validateEvents(ref, [event]);

            const encoded = yield* Schema.encodeEffect(EventJson)(event).pipe(
              Effect.mapError(invalidCache)
            );

            yield* repository
              .hydrateEvent(ref, version, event.eventId, encoded)
              .pipe(Effect.mapError(storageFailure));
          }
        ),
        invalidate: (ref) =>
          repository.invalidate(ref).pipe(Effect.mapError(storageFailure)),
        read,
        readRange: Effect.fn("D1CalendarStore.readRange")(
          function* readRange(ref, range, version) {
            const now = yield* Clock.currentTimeMillis;

            const encoded = yield* repository
              .readRange(ref, range.start, range.end, version, now)
              .pipe(Effect.mapError(storageFailure));

            return encoded === undefined
              ? encoded
              : yield* Schema.decodeEffect(EventArrayJson)(encoded).pipe(
                  Effect.mapError(invalidCache),
                  Effect.flatMap(validateEvents.bind(undefined, ref))
                );
          }
        ),
      });
    })
  );
