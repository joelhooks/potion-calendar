import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Context, Effect, Layer, Option, Ref, Stream } from "effect";

import { CalendarSearchClient } from "./client.js";
import { searchMachine } from "./machine.js";
import { SearchProblem } from "./model.js";
import type { SearchNotice, SearchTask } from "./model.js";
import { searchPageMachine } from "./page-machine.js";
import type {
  SearchDirection,
  SearchPageNotice,
  SearchPageTask,
} from "./page-model.js";
import { searchTaskScope } from "./source.js";

export class SearchRuntime extends Context.Service<
  SearchRuntime,
  {
    readonly dispatchPage: (
      direction: typeof SearchDirection.Type,
      page: typeof SearchPageTask.Type
    ) => Effect.Effect<void, typeof SearchProblem.Type>;
    readonly observePages: (
      task: typeof SearchTask.Type
    ) => Stream.Stream<typeof SearchPageNotice.Type>;
    readonly observe: (
      task: typeof SearchTask.Type
    ) => Stream.Stream<typeof SearchNotice.Type>;
  }
>()("@calendar/web/SearchRuntime") {
  static readonly layer = Layer.effect(
    SearchRuntime,
    Effect.gen(function* searchRuntime() {
      const client = yield* CalendarSearchClient;

      const active = yield* Ref.make(
        Option.none<{
          readonly actor: EffectActor<typeof searchPageMachine>;
          readonly task: typeof SearchTask.Type;
        }>()
      );

      return SearchRuntime.of({
        dispatchPage: (direction, page) =>
          Effect.gen(function* dispatchPage() {
            const current = yield* Ref.get(active);

            if (
              Option.isSome(current) &&
              current.value.task.revision === page.task.revision &&
              searchTaskScope(current.value.task) === searchTaskScope(page.task)
            ) {
              return yield* send(current.value.actor, {
                page,
                type: direction === "forward" ? "FORWARD" : "REVERSE",
              });
            }

            return yield* Effect.fail(
              SearchProblem.cases.Transport.make({
                message: "Search is not ready. Try loading this page again.",
              })
            );
          }),
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
        observePages: (task) =>
          Stream.unwrap(
            Effect.gen(function* searchPagesSession() {
              const actor = yield* createEffectActor(searchPageMachine, {
                input: task,
              });

              yield* watchActor("calendar.search.pages", actor);
              const session = { actor, task };

              yield* Ref.set(active, Option.some(session));
              yield* Effect.addFinalizer(() =>
                Ref.update(active, (current) =>
                  Option.isSome(current) && current.value === session
                    ? Option.none()
                    : current
                )
              );

              return snapshots(actor).pipe(
                Stream.mapEffect((snapshot) =>
                  snapshot.status === "error"
                    ? Effect.die(snapshot.error)
                    : Effect.succeed(snapshot.context.notice)
                ),
                Stream.filter(Option.isSome),
                Stream.map((notice) => notice.value),
                Stream.changesWith((previous, next) => previous === next)
              );
            }).pipe(Effect.provideService(CalendarSearchClient, client))
          ),
      });
    })
  );
}
