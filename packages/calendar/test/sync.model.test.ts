import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { CalendarChanges } from "../src/changes.js";
import type { CalendarChangedValue } from "../src/changes.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import { CalendarStore } from "../src/store.js";
import { CalendarSync, syncCalendar } from "../src/sync.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

const histories = Arbitrary.schema(
  Schema.Array(
    Schema.Literals(["change", "cancel", "partial", "expired"])
  ).check(Schema.isMaxLength(20))
);

describe("calendar sync command histories", () => {
  it.effect.prop(
    "only final-page commits move cursors; changes and resets publish their versions",
    { commands: histories },
    ({ commands }) =>
      Effect.gen(function* scenario0() {
        const fake = yield* fakeGoogle();

        const google = GoogleCalendarClient.layer.pipe(
          Layer.provide(fake.layer)
        );

        const published = yield* Ref.make<readonly CalendarChangedValue[]>([]);

        const signals = Layer.succeed(CalendarChanges, {
          publish: (change) =>
            Ref.update(published, (previous) => [...previous, change]),
        });

        const storage = Layer.mergeAll(google, memoryCalendarStore, signals);
        const layer = CalendarSync.layer.pipe(Layer.provideMerge(storage));
        yield* Effect.gen(function* scenario1() {
          const store = yield* CalendarStore;
          let cursor: string | undefined;
          let step = 0;
          let version = 0;
          let revision = 0;
          const expectedChanges: CalendarChangedValue[] = [];

          for (const command of commands) {
            const before = yield* store.read(ref);
            const id = `event-${step}`;
            const nextCursor = `cursor-${step}`;

            if (command === "partial") {
              yield* Ref.set(fake.pending, [
                response(200, {
                  items: [timedEvent(id)],
                  nextPageToken: "pending",
                }),
                response(403),
              ]);
              const error = yield* syncCalendar(ref).pipe(Effect.flip);
              expect(error._tag).toBe("Provider");
              expect(yield* store.read(ref)).toEqual(before);
            } else {
              if (command === "expired") {
                yield* Ref.set(fake.pending, [
                  response(410),
                  response(200, {
                    items: [timedEvent(id)],
                    nextSyncToken: nextCursor,
                  }),
                ]);
                version += 1;
                revision += 1;
                expectedChanges.push({ ...ref, reason: "reset", version });
              } else if (command === "cancel") {
                const cancelled = "event-0";
                yield* Ref.set(fake.pending, [
                  response(200, {
                    items: [{ id: cancelled, status: "cancelled" }],
                    nextSyncToken: nextCursor,
                  }),
                ]);
              } else {
                yield* Ref.set(fake.pending, [
                  response(200, {
                    items: [timedEvent(id)],
                    nextPageToken: "more",
                  }),
                  response(200, {
                    items: [timedEvent(`${id}-page2`)],
                    nextSyncToken: nextCursor,
                  }),
                ]);
              }

              const result = yield* syncCalendar(ref);
              cursor = nextCursor;
              version += 1;
              revision += 1;
              expectedChanges.push({ ...ref, reason: "sync", version });
              expect(result).toEqual({
                changed: command === "change" ? 2 : 1,
                cursor,
                version,
              });
            }

            const snapshot = yield* store.read(ref);
            expect(snapshot.cursor).toBe(cursor);
            expect(snapshot.version).toBe(version);
            expect(snapshot.revision).toBe(revision);
            expect(yield* Ref.get(published)).toEqual(expectedChanges);
            const requests = yield* Ref.get(fake.requests);

            for (const request of requests) {
              const query = new URL(`https://fake.test${request.path}`)
                .searchParams;

              expect(query.get("singleEvents")).toBe("false");
              expect(query.get("showDeleted")).toBe("true");
              expect(query.has("timeMin")).toBe(false);
              expect(query.has("timeMax")).toBe(false);
            }

            expect(yield* Ref.get(fake.pending)).toEqual([]);
            step += 1;
          }
        }).pipe(Effect.provide(layer));
      })
  );

  it.effect(
    "a failed full resync leaves no stale cursor and cannot loop on a second 410",
    () =>
      Effect.gen(function* scenario2() {
        const fake = yield* fakeGoogle([response(410), response(410)]);

        const google = GoogleCalendarClient.layer.pipe(
          Layer.provide(fake.layer)
        );

        const layer = CalendarSync.layer.pipe(
          Layer.provideMerge(Layer.merge(google, memoryCalendarStore))
        );

        yield* Effect.gen(function* scenario3() {
          const store = yield* CalendarStore;
          expect(yield* store.commit(ref, 0, 0, "expired")).toBe(true);
          const error = yield* syncCalendar(ref).pipe(Effect.flip);
          expect(error._tag).toBe("Gone");
          expect((yield* store.read(ref)).cursor).toBeUndefined();
          const requests = yield* Ref.get(fake.requests);
          expect(requests).toHaveLength(2);
          expect(requests[0]?.path).toContain("syncToken=expired");
          expect(requests[1]?.path).not.toContain("syncToken");
        }).pipe(Effect.provide(layer));
      })
  );

  it.effect(
    "compare-and-swap rejects a stale concurrent writer without changing data",
    () =>
      Effect.gen(function* scenario4() {
        const store = yield* CalendarStore;
        const first = yield* store.read(ref);
        expect(yield* store.commit(ref, first.revision, 0, "winner")).toBe(
          true
        );
        expect(yield* store.commit(ref, first.revision, 0, "stale")).toBe(
          false
        );
        expect(yield* store.clear(ref, first.revision)).toBe(false);
        expect((yield* store.read(ref)).cursor).toBe("winner");
        expect(
          (yield* store.read({ ...ref, accountId: "other" })).cursor
        ).toBeUndefined();
      }).pipe(Effect.provide(memoryCalendarStore))
  );
});
