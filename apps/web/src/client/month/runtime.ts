import { send } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";
import type { Scope } from "effect";

import { MonthSession } from "./model.js";
import type { monthScrollMachine } from "./scroll-machine.js";
import { monthViewRegistry } from "./view-state.js";
import type { MonthViewRegistry } from "./view-state.js";

type Actor = EffectActor<typeof monthScrollMachine>;

export const MonthReadOutcome = Schema.Struct({
  id: Schema.Int,
  session: MonthSession,
  success: Schema.Boolean,
});

export class MonthRuntime extends Context.Service<
  MonthRuntime,
  {
    readonly viewChanges: MonthViewRegistry["changes"];
    readonly bind: (
      hostKey: string,
      actor: Actor
    ) => Effect.Effect<typeof MonthSession.Type, never, Scope.Scope>;
    readonly acknowledge: (
      outcome: typeof MonthReadOutcome.Type
    ) => Effect.Effect<void>;
  }
>()("@calendar/web/MonthRuntime") {
  static readonly layer = Layer.unwrap(
    Effect.sync(() => MonthRuntime.layerFor(monthViewRegistry()))
  );

  static layerFor(registry: MonthViewRegistry) {
    return Layer.effect(
      this,
      Effect.gen(function* monthRuntime() {
        const sequence = yield* Ref.make(0);

        const active = yield* Ref.make(
          Option.none<{
            readonly session: typeof MonthSession.Type;
            readonly actor: Actor;
          }>()
        );

        return MonthRuntime.of({
          acknowledge: (outcome) =>
            Effect.gen(function* acknowledge() {
              const current = yield* Ref.get(active);

              if (
                Option.isSome(current) &&
                current.value.session.hostKey === outcome.session.hostKey &&
                current.value.session.id === outcome.session.id
              ) {
                yield* send(current.value.actor, {
                  id: outcome.id,
                  type: outcome.success ? "COVERED" : "FAILED",
                });
              }
            }),
          bind: (hostKey, actor) =>
            Effect.gen(function* bind() {
              const id = yield* Ref.updateAndGet(
                sequence,
                (value) => value + 1
              );

              const session = MonthSession.make({ hostKey, id });
              const value = { actor, session };
              yield* Ref.set(active, Option.some(value));
              yield* Effect.addFinalizer(() =>
                Ref.update(active, (current) =>
                  Option.isSome(current) && current.value === value
                    ? Option.none()
                    : current
                )
              );

              return session;
            }),
          viewChanges: registry.changes,
        });
      })
    );
  }
}
