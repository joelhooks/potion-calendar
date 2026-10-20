import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import {
  Context,
  Effect,
  Exit,
  PubSub,
  Queue,
  Schema,
  Scope,
  Stream,
} from "effect";
import type { SnapshotFrom } from "xstate";

import {
  DeleteIntent,
  DeleteOutcome,
  DeletionWriter,
  deleteUndoMachine,
  undoWindowMilliseconds,
} from "./delete-actor.js";
import type { DeleteIntentValue } from "./delete-actor.js";

export const DeleteCommand = Schema.TaggedUnion({
  Begin: { intent: DeleteIntent },
  Dismiss: { id: Schema.String },
  Leaving: {},
  Undo: { id: Schema.String },
});

export const DeleteNotice = Schema.TaggedUnion({
  Changed: {
    intent: DeleteIntent,
    keepalive: Schema.Boolean,
    phase: Schema.Literals(["pending", "committing"]),
  },
  Settled: { intent: DeleteIntent, outcome: DeleteOutcome },
});

type DeleteActor = EffectActor<typeof deleteUndoMachine>;

interface ActiveDelete {
  readonly actor: DeleteActor;
  readonly intent: DeleteIntentValue;
  readonly scope: Scope.Closeable;
}

interface DeleteEnvironment {
  readonly active: Map<string, ActiveDelete>;
  readonly parent: Scope.Scope;
  readonly updates: PubSub.PubSub<typeof DeleteNotice.Type>;
  readonly writer: DeletionWriter["Service"];
}

const publishSnapshot = Effect.fn("publishDeleteSnapshot")(
  function* publishDeleteSnapshot(
    environment: DeleteEnvironment,
    intent: DeleteIntentValue,
    snapshot: SnapshotFrom<typeof deleteUndoMachine>
  ) {
    if (snapshot.status === "error") {
      return yield* Effect.die(snapshot.error);
    }

    if (snapshot.status === "done") {
      const outcome = yield* Schema.decodeUnknownEffect(DeleteOutcome)(
        snapshot.output
      ).pipe(Effect.orDie);

      return yield* PubSub.publish(
        environment.updates,
        DeleteNotice.cases.Settled.make({ intent, outcome })
      ).pipe(Effect.asVoid);
    }

    if (snapshot.value === "pending" || snapshot.value === "committing") {
      return yield* PubSub.publish(
        environment.updates,
        DeleteNotice.cases.Changed.make({
          intent,
          keepalive: snapshot.context.keepalive,
          phase: snapshot.value,
        })
      ).pipe(Effect.asVoid);
    }

    return yield* Effect.void;
  }
);

const deletionActor = Effect.fn("deletionActor")(function* deletionActor(
  intent: DeleteIntentValue
) {
  const actor = yield* createEffectActor(deleteUndoMachine, {
    input: { intent, windowMilliseconds: undoWindowMilliseconds },
  });

  yield* watchActor("calendar.delete", actor);

  return actor;
});

const begin = Effect.fn("beginDeleteActor")(function* begin(
  environment: DeleteEnvironment,
  intent: DeleteIntentValue
) {
  if (environment.active.has(intent.id)) {
    return;
  }

  for (const pending of environment.active.values()) {
    if (
      pending.intent.request.accountId === intent.request.accountId &&
      pending.intent.request.calendarId === intent.request.calendarId &&
      pending.intent.request.eventId === intent.request.eventId
    ) {
      return;
    }
  }

  const scope = yield* Scope.fork(environment.parent);

  const actor = yield* deletionActor(intent).pipe(
    Effect.provideService(DeletionWriter, environment.writer),
    Scope.provide(scope)
  );

  environment.active.set(intent.id, { actor, intent, scope });
  yield* Stream.runForEach(snapshots(actor), (snapshot) =>
    publishSnapshot(environment, intent, snapshot)
  ).pipe(
    Effect.ensuring(
      Effect.gen(function* releaseDeleteActor() {
        if (environment.active.get(intent.id)?.actor === actor) {
          environment.active.delete(intent.id);
        }

        yield* Scope.close(scope, Exit.void);
      })
    ),
    Effect.forkIn(environment.parent)
  );
});

const control = Effect.fn("controlDeleteActor")(function* control(
  environment: DeleteEnvironment,
  id: string,
  event: Parameters<DeleteActor["send"]>[0]
) {
  const entry = environment.active.get(id);

  if (entry !== undefined) {
    yield* send(entry.actor, event);
  }
});

const handle = (
  environment: DeleteEnvironment,
  command: typeof DeleteCommand.Type
): Effect.Effect<void> =>
  DeleteCommand.match(command, {
    Begin: ({ intent }) => begin(environment, intent),
    Dismiss: ({ id }) => control(environment, id, { type: "DISMISS" }),
    Leaving: () =>
      Effect.gen(function* leaveWithDeletes() {
        for (const entry of environment.active.values()) {
          yield* send(entry.actor, { type: "PAGE_HIDDEN" });
        }
      }),
    Undo: ({ id }) => control(environment, id, { type: "UNDO" }),
  });

export class DeletionSession extends Context.Service<
  DeletionSession,
  {
    readonly dispatch: (
      command: typeof DeleteCommand.Type
    ) => Effect.Effect<void>;
    readonly subscribe: Effect.Effect<
      Stream.Stream<typeof DeleteNotice.Type>,
      never,
      Scope.Scope
    >;
  }
>()("@calendar/web/DeletionSession") {
  static readonly make = Effect.fn("DeletionSession.make")(function* make() {
    const parent = yield* Effect.scope;
    const writer = yield* DeletionWriter;
    const commands = yield* Queue.unbounded<typeof DeleteCommand.Type>();
    const updates = yield* PubSub.unbounded<typeof DeleteNotice.Type>();

    const environment: DeleteEnvironment = {
      active: new Map(),
      parent,
      updates,
      writer,
    };

    yield* Effect.forever(
      Queue.take(commands).pipe(
        Effect.flatMap((command) => handle(environment, command))
      )
    ).pipe(Effect.forkScoped);

    return DeletionSession.of({
      dispatch: (command) => Queue.offer(commands, command).pipe(Effect.asVoid),
      subscribe: PubSub.subscribe(updates).pipe(
        Effect.map(Stream.fromSubscription)
      ),
    });
  });
}
