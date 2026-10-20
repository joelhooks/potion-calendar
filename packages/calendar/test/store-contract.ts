import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { CalendarService } from "../src/calendar.js";
import { CalendarChanges } from "../src/changes.js";
import type { CalendarChangedValue } from "../src/changes.js";
import { GoogleCalendarClient } from "../src/google.js";
import { CalendarStore } from "../src/store.js";
import { CalendarSync, syncCalendar } from "../src/sync.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const histories = Arbitrary.schema(
  Schema.Array(
    Schema.Literals(["read", "emptySync", "changedSync", "write"])
  ).check(Schema.isMaxLength(20))
);

const range = {
  end: "2026-04-01T00:00:00-07:00",
  start: "2026-03-01T00:00:00-08:00",
};

export const calendarStoreContract = <E>(
  name: string,
  makeStoreLayer: () => Layer.Layer<CalendarStore, E>
) =>
  describe(name, () => {
    it.effect(
      "a 5000-change sync commits only bounded cursor and version metadata",
      () =>
        Effect.gen(function* largeSyncMetadata() {
          const items = Array.from({ length: 5000 }, (_, index) =>
            timedEvent(`event-${index}`)
          );

          const fake = yield* fakeGoogle([
            response(200, {
              items: items.slice(0, 2500),
              nextPageToken: "second",
            }),
            response(200, { items: items.slice(2500), nextSyncToken: "large" }),
          ]);

          const published = yield* Ref.make<readonly CalendarChangedValue[]>(
            []
          );

          const signals = Layer.succeed(CalendarChanges, {
            publish: (change) =>
              Ref.update(published, (previous) => [...previous, change]),
          });

          const base = Layer.mergeAll(
            GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer)),
            makeStoreLayer(),
            signals
          );

          const layer = CalendarSync.layer.pipe(Layer.provideMerge(base));
          yield* Effect.gen(function* verifyLargeSync() {
            const store = yield* CalendarStore;
            expect(yield* syncCalendar(ref)).toEqual({
              changed: 5000,
              cursor: "large",
              version: 1,
            });
            const large = yield* store.read(ref);
            expect(large).toEqual({ cursor: "large", revision: 1, version: 1 });
            expect(yield* Ref.get(published)).toEqual([
              { ...ref, reason: "sync", version: 1 },
            ]);
            yield* Ref.set(fake.pending, [
              response(200, {
                items: [timedEvent("one")],
                nextSyncToken: "small",
              }),
            ]);
            expect(yield* syncCalendar(ref)).toEqual({
              changed: 1,
              cursor: "small",
              version: 2,
            });
            const small = yield* store.read(ref);
            expect(small).toEqual({ cursor: "small", revision: 2, version: 2 });
            expect(JSON.stringify(large).length).toBe(
              JSON.stringify(small).length
            );
            expect(yield* Ref.get(fake.pending)).toEqual([]);
          }).pipe(Effect.provide(layer));
        })
    );
    it.effect.prop(
      "only calendar changes invalidate ranges; every successful mutation publishes its version",
      { commands: histories },
      ({ commands }) =>
        Effect.gen(function* cacheHistory() {
          const fake = yield* fakeGoogle();

          const published = yield* Ref.make<readonly CalendarChangedValue[]>(
            []
          );

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

          const layer = Layer.merge(
            CalendarService.layer,
            CalendarSync.layer
          ).pipe(Layer.provideMerge(base));

          yield* Effect.gen(function* runHistory() {
            const calendar = yield* CalendarService;
            const store = yield* CalendarStore;
            let cached = false;
            let version = 0;
            let requestCount = 0;
            const expectedChanges: CalendarChangedValue[] = [];

            for (const command of commands) {
              if (command === "read") {
                if (!cached) {
                  yield* Ref.set(fake.pending, [
                    response(200, { items: [timedEvent("event")] }),
                  ]);
                  requestCount += 1;
                }

                const listed = yield* calendar.listEvents({
                  calendars: [ref],
                  range,
                });

                expect(listed.versions).toEqual([{ ...ref, version }]);
                expect(listed.events.map((event) => event.eventId)).toEqual([
                  "event",
                ]);
                cached = true;
              } else if (command === "write") {
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
                version += 1;
                requestCount += 2;
                cached = false;
                expectedChanges.push({ ...ref, reason: "write", version });
              } else {
                yield* Ref.set(fake.pending, [
                  response(200, {
                    items: command === "emptySync" ? [] : [timedEvent("event")],
                    nextSyncToken: "cursor",
                  }),
                ]);
                const result = yield* syncCalendar(ref);
                requestCount += 1;

                if (command === "changedSync") {
                  version += 1;
                  cached = false;
                  expectedChanges.push({ ...ref, reason: "sync", version });
                }

                expect(result.version).toBe(version);
              }

              expect((yield* store.read(ref)).version).toBe(version);
              expect(yield* Ref.get(published)).toEqual(expectedChanges);
              expect(yield* Ref.get(fake.requests)).toHaveLength(requestCount);
              expect(yield* Ref.get(fake.pending)).toEqual([]);
            }
          }).pipe(Effect.provide(layer));
        })
    );

    it.effect(
      "an expired concurrent pull cannot clear a newer committed cursor",
      () =>
        Effect.gen(function* staleReset() {
          const fake = yield* fakeGoogle([response(410)]);

          const base = Layer.merge(
            GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer)),
            makeStoreLayer()
          );

          const layer = CalendarSync.layer.pipe(Layer.provideMerge(base));
          yield* Effect.gen(function* runStaleReset() {
            const sync = yield* CalendarSync;
            const store = yield* CalendarStore;
            const failure = yield* sync.pull(ref).pipe(Effect.flip);
            expect(failure._tag).toBe("SyncExpired");
            expect(yield* store.commit(ref, 0, 0, "newer")).toBe(true);
            const error = yield* sync.reset(ref, 0).pipe(Effect.flip);
            expect(error._tag).toBe("Provider");
            expect((yield* store.read(ref)).cursor).toBe("newer");
          }).pipe(Effect.provide(layer));
        })
    );
  });
