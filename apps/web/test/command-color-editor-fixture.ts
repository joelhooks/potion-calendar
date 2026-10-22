import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Crypto, Effect, Option, Schema, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { DeletionSession } from "../src/client/editing/deletion-session.js";
import {
  eventEditorMachine,
  projectEditor,
} from "../src/client/editing/editor-machine.js";
import {
  EditingCommand,
  EditingNotice,
} from "../src/client/editing/runtime.js";
import { commandChoiceFixture } from "./command-choice-fixture.js";
import { fixtureEvents } from "./fixture.js";

const EditingArgs = Schema.Struct({
  command: EditingCommand,
  personId: Schema.String,
});

type EditorActor = EffectActor<typeof eventEditorMachine>;

const waitEditor = (
  actor: EditorActor,
  predicate: (snapshot: ReturnType<EditorActor["getSnapshot"]>) => boolean
) =>
  snapshots(actor).pipe(
    Stream.filter(
      (snapshot) => snapshot.status === "error" || predicate(snapshot)
    ),
    Stream.runHead,
    Effect.flatMap((snapshot) => Effect.fromOption(snapshot)),
    Effect.filterOrElse(
      (snapshot) => snapshot.status !== "error",
      (snapshot) => Effect.die(snapshot.error)
    )
  );

export const stagedCommandColorFixture = Effect.fn("stagedCommandColorFixture")(
  function* stagedCommandColorFixture() {
    const selected = fixtureEvents.find(
      (event) => event.eventId === "a-review"
    );

    if (selected === undefined) {
      return yield* Effect.die("Missing command-color source");
    }

    const source = { ...selected, guestsCanModify: true };

    const writes: string[] = [];

    const refuseWrite = (operation: string) =>
      Effect.sync(() => {
        writes.push(operation);
      }).pipe(
        Effect.andThen(
          Effect.die("Color staging unexpectedly wrote to the provider")
        )
      );

    const client = CalendarEditingClient.of({
      createEvent: () => refuseWrite("create"),
      deleteEvent: () => refuseWrite("delete"),
      getEvent: () => Effect.succeed(source),
      moveAndRetimeSeries: () => refuseWrite("series"),
      moveEvent: () => refuseWrite("move"),
      moveSupport: "notAvailable",
      rsvp: () => refuseWrite("rsvp"),
      updateEvent: () => refuseWrite("update"),
    });

    const deletion = DeletionSession.of({
      dispatch: () => refuseWrite("deletion-session"),
      subscribe: Effect.succeed(Stream.empty),
    });

    const crypto = yield* Crypto.Crypto;

    const actor = yield* createEffectActor(eventEditorMachine).pipe(
      Effect.provideService(CalendarEditingClient, client),
      Effect.provideService(DeletionSession, deletion),
      Effect.provideService(Crypto.Crypto, crypto)
    );

    yield* watchActor("calendar.command-color.test", actor);
    const base = commandChoiceFixture();
    const opened = update(base, Message.KeyboardAction({ id: "colors" })).model;
    const picked = update(opened, Message.KeyboardPick({ id: "color-7" }));
    const personId = Option.getOrThrow(base.person);

    const notice = (view: ReturnType<typeof projectEditor>) =>
      Message.ReceivedEditing({
        notice: EditingNotice.cases.Editor.make({
          error: Option.none(),
          mutation: Option.none(),
          plan: Option.none(),
          saving: false,
          view,
        }),
        personId,
      });

    const { model: initial } = update(
      picked.model,
      notice(projectEditor(actor.getSnapshot()))
    );

    const openCommands = (picked.commands ?? [])
      .filter((command) => command.name === "DispatchEditing")
      .map((command) => Schema.decodeUnknownSync(EditingArgs)(command.args));

    if (openCommands.length !== 1) {
      return yield* Effect.die(
        "Command color did not issue one editor request"
      );
    }

    for (const { command } of openCommands) {
      if (!EditingCommand.guards.Open(command)) {
        return yield* Effect.die("Color choice bypassed editor loading");
      }

      yield* send(actor, { request: command.request, type: "OPEN" });
    }

    const ready = yield* waitEditor(actor, (snapshot) =>
      snapshot.matches("editing")
    );

    const initialColor = ready.context.session?.draft.colorId;
    const handoff = update(initial, notice(projectEditor(ready)));

    const actions = (handoff.commands ?? [])
      .filter((command) => command.name === "DispatchEditing")
      .map((command) => Schema.decodeUnknownSync(EditingArgs)(command.args));

    if (actions.length !== 1) {
      return yield* Effect.die(
        "Matching editor did not receive one color handoff"
      );
    }

    for (const { command } of actions) {
      if (!EditingCommand.guards.Action(command)) {
        return yield* Effect.die("Color handoff issued another editor request");
      }

      yield* send(actor, { action: command.action, type: "ACTION" });
    }

    const changed = yield* waitEditor(
      actor,
      (snapshot) =>
        snapshot.matches("editing") &&
        snapshot.context.session !== ready.context.session
    );

    const result = update(handoff.model, notice(projectEditor(changed)));

    return {
      actorState: changed.value,
      initialColor,
      model: result.model,
      rootCommands: [...openCommands, ...actions].map(({ command }) => command),
      source,
      writes,
    };
  }
);
