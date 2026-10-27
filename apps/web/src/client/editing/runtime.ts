import { CalendarEvent } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { TrayRsvpNote } from "@calendar/core/desktop-bridge";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import {
  Context,
  Crypto,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  Stream,
} from "effect";
import type { Scope } from "effect";

import { BulkPlan } from "../../layout/bulk-plans.js";
import { SelectionSet } from "../../layout/selection-set.js";
import { bulkMachine } from "../bulk/machine.js";
import { BulkView } from "../bulk/model.js";
import { CalendarEditingClient } from "./calendar-client.js";
import { DeletionWriter } from "./delete-actor.js";
import {
  DeleteCommand,
  DeleteNotice,
  DeletionSession,
} from "./deletion-session.js";
import { EditorAction } from "./editor-action.js";
import { eventEditorMachine, projectEditor } from "./editor-machine.js";
import { EditorView } from "./editor-model.js";
import {
  EditorMutation,
  EditorRequest,
  WritePlan,
} from "./editor-session-model.js";
import { EditorInputFailure } from "./input-failure.js";
import {
  PreparedRsvpNote,
  RsvpView,
  projectRsvp,
  rsvpMachine,
} from "./rsvp-machine.js";

export const EditingCommand = Schema.TaggedUnion({
  Action: { action: EditorAction },
  Bulk: { plan: BulkPlan, selection: SelectionSet },
  ClearBulk: {},
  Leave: {},
  Open: { request: EditorRequest },
  Rsvp: {
    event: CalendarEvent,
    notePolicy: Schema.optional(Schema.Literal("omit")),
    response: Schema.Literals(["accepted", "declined", "tentative"]),
  },
  RsvpClearPreparation: { prepared: PreparedRsvpNote },
  RsvpNote: { event: CalendarEvent, note: Schema.String },
  RsvpPrepare: { event: CalendarEvent, intent: TrayRsvpNote },
});

export const EditingNotice = Schema.TaggedUnion({
  Bulk: { view: BulkView },
  Delete: { notice: DeleteNotice },
  Editor: {
    error: Schema.Option(Schema.String),
    mutation: Schema.Option(EditorMutation),
    plan: Schema.Option(WritePlan),
    saving: Schema.Boolean,
    view: EditorView,
  },
  Rsvp: { view: RsvpView },
});

interface HostedSession {
  readonly dispatch: (
    command: typeof EditingCommand.Type
  ) => Effect.Effect<void>;
  readonly personId: string;
}

const editorActor = Effect.gen(function* editorActor() {
  const actor = yield* createEffectActor(eventEditorMachine);

  yield* watchActor("calendar.editor", actor);

  return actor;
});

const bulkActor = Effect.gen(function* bulkActor() {
  const actor = yield* createEffectActor(bulkMachine);
  yield* watchActor("calendar.bulk", actor);

  return actor;
});

const responseActor = Effect.gen(function* responseActor() {
  const actor = yield* createEffectActor(rsvpMachine);

  yield* watchActor("calendar.rsvp", actor);

  return actor;
});

export class EditingRuntime extends Context.Service<
  EditingRuntime,
  {
    readonly connect: (
      personId: string
    ) => Effect.Effect<
      Stream.Stream<typeof EditingNotice.Type>,
      never,
      Scope.Scope
    >;
    readonly dispatch: (
      personId: string,
      command: typeof EditingCommand.Type
    ) => Effect.Effect<void, EditorInputFailure>;
  }
>()("@calendar/web/EditingRuntime") {
  static readonly layer = Layer.effect(
    EditingRuntime,
    Effect.gen(function* editingRuntime() {
      const client = yield* CalendarEditingClient;
      const crypto = yield* Crypto.Crypto;
      const writer = yield* DeletionWriter;
      const current = yield* Ref.make(Option.none<HostedSession>());

      return EditingRuntime.of({
        connect: Effect.fn("EditingRuntime.connect")(function* connect(
          personId: string
        ) {
          const deletion = yield* DeletionSession.make().pipe(
            Effect.provideService(DeletionWriter, writer)
          );

          const deletes = yield* deletion.subscribe;

          const editor = yield* editorActor.pipe(
            Effect.provideService(CalendarEditingClient, client),
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.provideService(DeletionSession, deletion)
          );

          const bulk = yield* bulkActor.pipe(
            Effect.provideService(CalendarEditingClient, client),
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.provideService(DeletionSession, deletion)
          );

          const rsvp = yield* responseActor.pipe(
            Effect.provideService(CalendarEditingClient, client)
          );

          const session: HostedSession = {
            dispatch: (command) =>
              EditingCommand.match(command, {
                Action: ({ action }) => {
                  if (EditorAction.guards.Undo(action)) {
                    return deletion.dispatch(
                      DeleteCommand.cases.Undo.make({ id: action.id })
                    );
                  }

                  if (EditorAction.guards.DismissUndo(action)) {
                    return deletion.dispatch(
                      DeleteCommand.cases.Dismiss.make({ id: action.id })
                    );
                  }

                  return send(editor, { action, type: "ACTION" });
                },
                Bulk: ({ plan, selection }) =>
                  crypto.randomUUIDv4.pipe(
                    Effect.orDie,
                    Effect.flatMap((id) =>
                      send(bulk, { id, plan, selection, type: "RUN" })
                    )
                  ),
                ClearBulk: () => send(bulk, { type: "CLEAR" }),
                Leave: () =>
                  deletion.dispatch(DeleteCommand.cases.Leaving.make({})),
                Open: ({ request }) => send(editor, { request, type: "OPEN" }),
                Rsvp: ({ event, response, notePolicy }) =>
                  notePolicy === "omit"
                    ? send(rsvp, { event, response, type: "RESPOND" })
                    : send(rsvp, {
                        event: Option.some(event),
                        type: "FOCUS",
                      }).pipe(
                        Effect.andThen(send(rsvp, { response, type: "CHOOSE" }))
                      ),
                RsvpClearPreparation: ({ prepared }) =>
                  send(rsvp, { prepared, type: "CLEAR_NOTE" }),
                RsvpNote: ({ event, note }) =>
                  send(rsvp, { event: Option.some(event), type: "FOCUS" }).pipe(
                    Effect.andThen(send(rsvp, { note, type: "NOTE" }))
                  ),
                RsvpPrepare: ({ event, intent }) =>
                  send(rsvp, { event, intent, type: "STAGE_NOTE" }),
              }),
            personId,
          };

          yield* Ref.set(current, Option.some(session));
          yield* Effect.addFinalizer(() =>
            Ref.update(current, (value) =>
              Option.isSome(value) && value.value === session
                ? Option.none()
                : value
            )
          );

          const editorNotices = snapshots(editor).pipe(
            Stream.mapEffect((snapshot) =>
              snapshot.status === "error"
                ? Effect.die(snapshot.error)
                : Effect.succeed(
                    EditingNotice.cases.Editor.make({
                      error: Option.fromUndefinedOr(snapshot.context.error),
                      mutation: Option.fromUndefinedOr(
                        snapshot.context.mutation
                      ),
                      plan: Option.fromUndefinedOr(snapshot.context.plan),
                      saving: snapshot.matches("saving"),
                      view: projectEditor(snapshot),
                    })
                  )
            )
          );

          const editorAndDeletes = Stream.merge(
            editorNotices,
            deletes.pipe(
              Stream.map((notice) =>
                EditingNotice.cases.Delete.make({ notice })
              )
            )
          );

          const responses = snapshots(rsvp).pipe(
            Stream.mapEffect((snapshot) =>
              snapshot.status === "error"
                ? Effect.die(snapshot.error)
                : Effect.succeed(
                    EditingNotice.cases.Rsvp.make({
                      view: projectRsvp(snapshot),
                    })
                  )
            )
          );

          const bulkNotices = snapshots(bulk).pipe(
            Stream.mapEffect((snapshot) =>
              snapshot.status === "error"
                ? Effect.die(snapshot.error)
                : Effect.succeed(
                    EditingNotice.cases.Bulk.make({
                      view: snapshot.context.view,
                    })
                  )
            )
          );

          return Stream.merge(
            Stream.merge(editorAndDeletes, responses),
            bulkNotices
          );
        }),
        dispatch: Effect.fn("EditingRuntime.dispatch")(function* dispatch(
          personId: string,
          command: typeof EditingCommand.Type
        ) {
          const active = yield* Ref.get(current);

          if (Option.isNone(active) || active.value.personId !== personId) {
            return yield* new EditorInputFailure({
              message: "The editor is not ready for this signed-in person.",
            });
          }

          const preparedOwner = EditingCommand.guards.RsvpPrepare(command)
            ? command.intent.personId
            : undefined;

          if (preparedOwner !== undefined && preparedOwner !== personId) {
            return yield* new EditorInputFailure({
              message:
                "This response note belongs to another signed-in person.",
            });
          }

          return yield* active.value.dispatch(command);
        }),
      });
    })
  );
}
