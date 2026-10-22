import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Option, Queue, Ref, Schema, Stream } from "effect";
import { FetchHttpClient } from "effect/http";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import type { GestureResult } from "../src/client/editing/gesture-model.js";
import { modelGestureHostKey } from "../src/client/editing/gesture-targets.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { editingRpcFixture } from "./editing-rpc-fixture.js";

export const openCreatedGridDraft = Effect.fn("openCreatedGridDraft")(
  function* openCreatedGridDraft(
    model: AppModel,
    gesture: typeof GestureResult.Type
  ) {
    const personId = Option.getOrThrow(model.person);

    const result = update(
      model,
      Message.CompletedGesture({
        gesture,
        hostKey: Option.getOrThrow(modelGestureHostKey(model)),
        personId,
      })
    );

    const dispatched = result.commands?.find(
      (command) => command.name === "DispatchEditing"
    );

    const command = yield* Schema.decodeUnknownEffect(EditingCommand)(
      dispatched?.args?.command
    );

    const api = yield* editingRpcFixture([]);

    const services = Layer.merge(
      CalendarEditingClient.layer("available"),
      Layer.succeed(
        DeletionWriter,
        DeletionWriter.of({
          commit: () =>
            Effect.die("Opening a grid draft must not delete an event"),
        })
      )
    );

    const context = yield* Layer.build(
      EditingRuntime.layer.pipe(Layer.provide(services))
    );

    const runtime = yield* Effect.service(EditingRuntime).pipe(
      Effect.provide(context)
    );

    let current = result.model;
    const queue = yield* Queue.unbounded<typeof EditingNotice.Type>();

    const notices = yield* runtime
      .connect(personId)
      .pipe(Effect.provideService(FetchHttpClient.Fetch, api.fetcher));

    yield* notices.pipe(
      Stream.runForEach((notice) =>
        Effect.sync(() => {
          current = update(
            current,
            Message.ReceivedEditing({ notice, personId })
          ).model;
          Queue.offerUnsafe(queue, notice);
        })
      ),
      Effect.forkScoped
    );
    yield* runtime.dispatch(personId, command);
    yield* Stream.fromQueue(queue).pipe(
      Stream.filter(
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Editing(notice.view)
      ),
      Stream.runHead
    );
    const requests = yield* Ref.get(api.fake.requests);

    if (requests.length !== 0 || api.requests.length !== 0) {
      return yield* Effect.die(
        "Opening a grid draft unexpectedly called the provider or RPC"
      );
    }

    return current;
  },
  Effect.provide(NodeServices.layer)
);
