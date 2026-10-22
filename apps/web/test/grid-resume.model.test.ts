import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { initialTransition, transition } from "xstate";

import { visibilityResumeMachine } from "../src/client/grid-resume/machine.js";

it.effect.prop(
  "visibility histories resume once per hidden period of at least thirty minutes and preserve the first hidden timestamp",
  {
    history: Schema.Array(
      Schema.Struct({
        elapsed: Schema.Int.check(
          Schema.isBetween({ maximum: 1_900_000, minimum: 0 })
        ),
        hidden: Schema.Boolean,
      })
    ).check(Schema.isMaxLength(30)),
  },
  ({ history }) =>
    Effect.sync(() => {
      let [snapshot] = initialTransition(visibilityResumeMachine);
      let hiddenSince: number | undefined;
      let now = 100_000;

      for (const command of history) {
        now += command.elapsed;
        let expected: number | undefined;

        if (command.hidden) {
          hiddenSince ??= now;
        } else {
          if (hiddenSince !== undefined && now - hiddenSince >= 1_800_000) {
            expected = now;
          }

          hiddenSince = undefined;
        }

        [snapshot] = transition(visibilityResumeMachine, snapshot, {
          now,
          type: command.hidden ? "HIDDEN" : "VISIBLE",
        });
        expect(Option.getOrUndefined(snapshot.context.resumeAt)).toBe(expected);
        expect(Option.getOrUndefined(snapshot.context.hiddenSince)).toBe(
          hiddenSince
        );
        expect(snapshot.value).toBe(
          hiddenSince === undefined ? "visible" : "hidden"
        );
      }
    })
);

it.effect(
  "twenty-nine minutes, duplicate visibility and a backwards clock do not become a thirty-minute return",
  () =>
    Effect.sync(() => {
      for (const duration of [29 * 60_000, 30 * 60_000, -1]) {
        let [snapshot] = initialTransition(visibilityResumeMachine);
        [snapshot] = transition(visibilityResumeMachine, snapshot, {
          now: 1000,
          type: "HIDDEN",
        });
        [snapshot] = transition(visibilityResumeMachine, snapshot, {
          now: 1000 + duration,
          type: "VISIBLE",
        });
        expect(Option.isSome(snapshot.context.resumeAt)).toBe(
          duration === 30 * 60_000
        );
        [snapshot] = transition(visibilityResumeMachine, snapshot, {
          now: 10_000_000,
          type: "VISIBLE",
        });
        expect(Option.isNone(snapshot.context.resumeAt)).toBe(true);
      }
    })
);
