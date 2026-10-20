import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema, Stream } from "effect";
import type { Mount } from "foldkit";

import { monthViewRegistry } from "../src/client/month/view-state.js";

it.effect.prop(
  "generated month mount leases cannot revive a released or replaced live view",
  {
    history: Schema.Array(
      Schema.Literals(["register", "live", "pause", "release", "stale"])
    ).check(Schema.isMaxLength(30)),
  },
  ({ history }) =>
    Effect.gen(function* viewLeases() {
      const registry = monthViewRegistry();
      const leases: ReturnType<typeof registry.register>[] = [];
      let active: number | undefined;
      let expected: Mount.ViewState = "Paused";
      let revision = 0;

      for (const command of history) {
        if (command === "register") {
          leases.push(registry.register());
          active = leases.length - 1;
          expected = "Paused";
        } else if (command === "stale") {
          for (const [index, lease] of leases.entries()) {
            if (index !== active) {
              lease.set("Live");

              const snapshot = Option.getOrThrow(
                yield* registry.changes.pipe(Stream.runHead)
              );

              expect(snapshot.state).toBe(expected);
              lease.release();
            }
          }
        } else if (active !== undefined) {
          const lease = leases[active];

          if (lease === undefined) {
            throw new Error("Missing generated view lease");
          }

          if (command === "release") {
            lease.release();
            active = undefined;
            expected = "Paused";
          } else {
            expected = command === "live" ? "Live" : "Paused";
            lease.set(expected);
          }
        }

        const { state, revision: nextRevision } = Option.getOrThrow(
          yield* registry.changes.pipe(Stream.runHead)
        );

        expect(state).toBe(expected);
        expect(nextRevision).toBeGreaterThanOrEqual(revision);
        revision = nextRevision;
      }
    })
);
