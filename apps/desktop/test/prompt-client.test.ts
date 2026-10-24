// oxlint-disable typescript/promise-function-async, promise/avoid-new -- Owned fake IPC text ports expose one controlled Promise without an async state machine or an Effect runner.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Exit, Schema } from "effect";

import { DesktopError } from "../src/config.js";
import { createPromptBridge } from "../src/prompt-client.js";

const unexpectedSound = (): never => {
  throw new Error("View-only clients must not send or subscribe to sound work");
};

const revision = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 1 }))
);

const wire = (value: number) => JSON.stringify({ events: [], revision: value });

it.effect.prop(
  "a late initial prompt read cannot replace a newer pushed view",
  { revision },
  ({ revision: current }) =>
    Effect.gen(function* initialReadRace() {
      const deferred = {
        resolve: (_value: string): void => {
          throw new Error("Prompt read was not started");
        },
      };

      // @effect-diagnostics-next-line newPromise:off -- This owned native IPC fixture must resolve after a pushed view without starting an Effect runtime in the test.
      const pending = new Promise<string>((resolve) => {
        deferred.resolve = resolve;
      });

      const listeners = new Set<(message: string) => void>();
      const observed: number[] = [];

      const api = createPromptBridge({
        act: () => {
          throw new Error("No action expected");
        },
        read: () => pending,
        rejected: () => {
          throw new Error("No rejection expected");
        },
        soundReply: unexpectedSound,
        subscribe: (receive) => {
          listeners.add(receive);

          return () => {
            listeners.delete(receive);
          };
        },
        subscribeSound: unexpectedSound,
      });

      const stop = api.onView((view) => {
        observed.push(view.revision);
      });

      const initial = api.getView();

      for (const receive of listeners) {
        receive(wire(current + 1));
      }

      deferred.resolve(wire(current));

      const result = yield* Effect.tryPromise({
        catch: (cause) =>
          new DesktopError({ cause, message: "Prompt read failed" }),
        // oxlint-disable-next-line typescript/promise-function-async -- This test awaits the one already-started native Promise after delivering a newer push.
        try: () => initial,
      });

      expect(result.revision).toBe(current + 1);

      for (const receive of listeners) {
        receive(wire(current - 1));
      }

      expect(observed).toEqual([current + 1]);
      stop();
      expect(listeners.size).toBe(0);
    })
);

it.effect(
  "malformed prompt views are refused rather than delivered to the card",
  () =>
    Effect.gen(function* malformedView() {
      const listeners = new Set<(message: string) => void>();
      const counts = { received: 0, rejected: 0 };

      const api = createPromptBridge({
        act: () => {
          throw new Error("No action expected");
        },
        read: () => Promise.resolve('{"events":"not an array","revision":1}'),
        rejected: () => {
          counts.rejected += 1;
        },
        soundReply: unexpectedSound,
        subscribe: (receive) => {
          listeners.add(receive);

          return () => {
            listeners.delete(receive);
          };
        },
        subscribeSound: unexpectedSound,
      });

      api.onView(() => {
        counts.received += 1;
      });

      for (const receive of listeners) {
        receive('{"events":[],"revision":0.5}');
      }

      const result = yield* Effect.tryPromise({
        catch: (cause) =>
          new DesktopError({ cause, message: "Rejected prompt view" }),
        // oxlint-disable-next-line typescript/promise-function-async -- The fake native Promise is the seam under test.
        try: () => api.getView(),
      }).pipe(Effect.exit);

      expect(Exit.isFailure(result)).toBe(true);
      expect(counts).toEqual({ received: 0, rejected: 2 });
    })
);
