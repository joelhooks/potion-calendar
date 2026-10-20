import { Effect, Ref } from "effect";

import type { MaintenanceValue } from "../../src/server/live-maintenance-state.js";
import { maintenanceStateWith } from "../../src/server/live-maintenance-state.js";

export const memoryMaintenanceState = Effect.gen(
  function* memoryMaintenanceState() {
    const values = yield* Ref.make<ReadonlyMap<string, unknown>>(new Map());

    const store = {
      read: (key: string) =>
        Ref.get(values).pipe(Effect.map((current) => current.get(key))),
      write: (key: string, value: MaintenanceValue) =>
        Ref.update(values, (current) => new Map(current).set(key, value)),
    };

    return { make: () => maintenanceStateWith(store), values };
  }
);
