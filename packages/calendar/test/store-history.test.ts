import { expect, it } from "@effect/vitest";
import { Effect, Layer, Predicate, Ref, Schema } from "effect";

import { Provider } from "../src/errors.js";
import { memoryCalendarStore } from "../src/memory.js";
import { CalendarStore } from "../src/store.js";
import { runStoreHistory, StoreObservationsJson } from "./store-history.js";
import type { StoreCommandValue } from "./store-history.js";

it.effect.prop(
  "a failed metadata observation retains the completed prefix and phase without an invented snapshot or later commands",
  { completed: Schema.Literals([0, 1, 2, 3, 4]) },
  ({ completed }) =>
    Effect.gen(function* failedObservationPrefix() {
      const commits = yield* Ref.make(0);

      const failingStore = Layer.effect(
        CalendarStore,
        Effect.gen(function* failingStore() {
          const source = yield* CalendarStore;
          const armed = yield* Ref.make(false);

          return CalendarStore.of({
            ...source,
            commit: (ref, expectedRevision, changed, cursor) =>
              source.commit(ref, expectedRevision, changed, cursor).pipe(
                Effect.tap(() =>
                  Effect.gen(function* armObservationFailure() {
                    yield* Ref.update(commits, (count) => count + 1);

                    if ((yield* Ref.get(commits)) === completed + 1) {
                      yield* Ref.set(armed, true);
                    }
                  })
                )
              ),
            read: (ref) =>
              Ref.get(armed).pipe(
                Effect.flatMap((fail) =>
                  fail
                    ? Effect.fail(
                        new Provider({
                          message: "Deliberate metadata read fault",
                          operation: "test-observation",
                          status: 0,
                        })
                      )
                    : source.read(ref)
                )
              ),
          });
        })
      ).pipe(Layer.provide(memoryCalendarStore));

      const commands = Array.from(
        { length: completed + 2 },
        (): StoreCommandValue => "emptySync"
      );

      const observed = yield* runStoreHistory(commands, () => failingStore);
      const wire = yield* Schema.encodeEffect(StoreObservationsJson)(observed);
      const decoded = yield* Schema.decodeEffect(StoreObservationsJson)(wire);

      expect(decoded).toEqual(observed);
      expect(decoded).toHaveLength(completed + 1);
      expect(decoded.slice(0, completed).map((step) => step._tag)).toEqual(
        Array.from({ length: completed }, () => "Observed")
      );
      const failed = decoded[completed];

      expect(Predicate.isTagged(failed, "Failed")).toBe(true);

      if (Predicate.isTagged(failed, "Failed")) {
        expect(failed.cause).toContain("Deliberate metadata read fault");
        expect(failed.command).toBe("emptySync");
        expect(failed.phase).toBe("observation");
      }

      expect(failed).not.toHaveProperty("snapshot");
      expect(yield* Ref.get(commits)).toBe(completed + 1);
    })
);
