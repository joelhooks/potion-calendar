import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, snapshots } from "@xstate/effect";
import { Context, Effect, Layer, Stream } from "effect";

import { CalendarSearchClient } from "./client.js";
import { searchMachine } from "./machine.js";
import type { SearchNotice, SearchTask } from "./model.js";

export class SearchRuntime extends Context.Service<
  SearchRuntime,
  {
    readonly observe: (
      task: typeof SearchTask.Type
    ) => Stream.Stream<typeof SearchNotice.Type>;
  }
>()("@calendar/web/SearchRuntime") {
  static readonly layer = Layer.effect(
    SearchRuntime,
    Effect.gen(function* searchRuntime() {
      const client = yield* CalendarSearchClient;

      return SearchRuntime.of({
        observe: (task) =>
          Stream.unwrap(
            Effect.gen(function* searchSession() {
              const actor = yield* createEffectActor(searchMachine, {
                input: task,
              });

              yield* watchActor("calendar.search", actor);

              return snapshots(actor).pipe(
                Stream.mapEffect((snapshot) =>
                  snapshot.status === "error"
                    ? Effect.die(snapshot.error)
                    : Effect.succeed(snapshot.context.notice)
                )
              );
            }).pipe(Effect.provideService(CalendarSearchClient, client))
          ),
      });
    })
  );
}
