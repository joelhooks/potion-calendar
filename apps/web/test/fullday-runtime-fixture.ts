import { NodeServices } from "@effect/platform-node";
import {
  Crypto,
  Effect,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import { FetchHttpClient } from "effect/http";

import {
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionWriter } from "../src/client/editing/delete-actor.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import {
  EditingCommand,
  EditingNotice,
  EditingRuntime,
} from "../src/client/editing/runtime.js";
import { dayFromIso, isoFromDay } from "../src/layout/navigation.js";
import { editingRpcFixture } from "./editing-rpc-fixture.js";

export const fulldaySession = Effect.fn("test.fulldaySession")(
  function* fulldaySession(
    model: AppModel,
    command: typeof EditingCommand.Type,
    date: string
  ) {
    const personId = Option.getOrThrow(model.person);

    const calendar = yield* Effect.fromNullishOr(model.calendar.calendars[0]);

    const api = yield* editingRpcFixture([
      response(200, {
        accessRole: "owner",
        defaultReminders: [{ method: "popup", minutes: 30 }],
        id: calendar.calendarId,
      }),
      response(
        200,
        timedEvent("01010101010141018101010101010101", "Full-day proof", {
          end: { date: isoFromDay(dayFromIso(date) + 1) },
          reminders: { overrides: [], useDefault: false },
          start: { date },
        })
      ),
    ]);

    const services = Layer.merge(
      CalendarEditingClient.layer("available"),
      Layer.succeed(
        DeletionWriter,
        DeletionWriter.of({
          commit: () =>
            Effect.die("Creating a full-day draft must never delete an event"),
        })
      )
    );

    const context = yield* Layer.build(
      EditingRuntime.layer.pipe(Layer.provide(services))
    ).pipe(
      Effect.provideService(
        Crypto.Crypto,
        Crypto.make({
          digest: () => Effect.die("Unexpected digest"),
          randomBytes: (size) => new Uint8Array(size).fill(1),
        })
      )
    );

    const runtime = yield* Effect.service(EditingRuntime).pipe(
      Effect.provide(context)
    );

    let current = model;
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

    const awaitNotice = (
      matches: (notice: typeof EditingNotice.Type) => boolean
    ) =>
      Stream.fromQueue(queue).pipe(
        Stream.filter(matches),
        Stream.runHead,
        Effect.flatMap(Effect.fromOption)
      );

    yield* runtime.dispatch(personId, command);
    yield* awaitNotice(
      (notice) =>
        EditingNotice.guards.Editor(notice) &&
        EditorView.guards.Editing(notice.view)
    );
    const initialRequests = yield* Ref.get(api.fake.requests);

    if (initialRequests.length !== 0 || api.requests.length !== 0) {
      return yield* Effect.die("Draft preparation unexpectedly performed IO");
    }

    const opened = current;

    const dispatch = Effect.fn("test.dispatchFulldayEditor")(function* dispatch(
      action: typeof EditorAction.Type
    ) {
      const result = update(current, Message.EditingAction({ action }));
      current = result.model;

      for (const item of result.commands ?? []) {
        if (item.name === "DispatchEditing") {
          yield* runtime.dispatch(
            personId,
            yield* Schema.decodeUnknownEffect(EditingCommand)(
              item.args?.command
            )
          );
        }
      }
    });

    const save = Effect.fn("test.saveFulldayDraft")(function* save() {
      yield* dispatch(
        EditorAction.cases.TextEdited.make({
          field: "title",
          value: "Full-day proof",
        })
      );
      yield* awaitNotice(
        (notice) =>
          EditingNotice.guards.Editor(notice) &&
          EditorView.guards.Editing(notice.view) &&
          notice.view.draft.title === "Full-day proof"
      );
      yield* dispatch(EditorAction.cases.Save.make({}));
      yield* awaitNotice(
        (notice) =>
          EditingNotice.guards.Editor(notice) && Option.isSome(notice.mutation)
      );

      return { requests: yield* Ref.get(api.fake.requests), rpc: api.requests };
    });

    return { get: () => current, opened, save };
  },
  Effect.provide(NodeServices.layer)
);
