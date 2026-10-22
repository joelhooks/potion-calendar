import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, snapshots } from "@xstate/effect";
import { Context, Effect, Layer, Stream } from "effect";

import { OccurrenceClient } from "./client.js";
import { occurrenceNavigationMachine } from "./machine.js";
import type { OccurrenceNotice, OccurrenceTask } from "./model.js";

export class OccurrenceRuntime extends Context.Service<
  OccurrenceRuntime,
  {
    readonly observe: (
      task: typeof OccurrenceTask.Type
    ) => Stream.Stream<typeof OccurrenceNotice.Type>;
  }
>()("@calendar/web/OccurrenceRuntime") {
  static readonly layer = Layer.effect(
    OccurrenceRuntime,
    Effect.gen(function* occurrenceRuntime() {
      const client = yield* OccurrenceClient;

      return OccurrenceRuntime.of({
        observe: (task) =>
          Stream.unwrap(
            Effect.gen(function* occurrenceSession() {
              const actor = yield* createEffectActor(
                occurrenceNavigationMachine,
                { input: task }
              );

              yield* watchActor("calendar.occurrenceNavigation", actor);

              return snapshots(actor).pipe(
                Stream.mapEffect((snapshot) =>
                  snapshot.status === "error"
                    ? Effect.die(snapshot.error)
                    : Effect.succeed(snapshot.context.notice)
                )
              );
            }).pipe(Effect.provideService(OccurrenceClient, client))
          ),
      });
    })
  );
}
