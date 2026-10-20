import { watchActor } from "@calendar/capability/actor-watch";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
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

import { CalendarEditingClient } from "../editing/calendar-client.js";
import { DeletionWriter } from "../editing/delete-actor.js";
import { DeletionSession } from "../editing/deletion-session.js";
import { clipboardMachine, ClipboardReceipt } from "./machine.js";
import {
  ClipboardGuestChoice,
  ClipboardInputFailure,
  ClipboardView,
} from "./model.js";
import type { ClipboardIdentity, NativeClipboardNotice } from "./model.js";
import { projectClipboard } from "./projection.js";

export const ClipboardAction = Schema.TaggedUnion({
  Abandon: { intentId: Schema.String },
  Cancel: { intentId: Schema.String },
  DismissToast: { id: Schema.String },
  Guests: { choice: ClipboardGuestChoice, intentId: Schema.String },
  Retry: { intentId: Schema.String },
});

export const ClipboardNotice = Schema.TaggedUnion({
  Receipt: { receipt: ClipboardReceipt },
  State: { view: ClipboardView },
});

export interface ClipboardConnection {
  readonly canReceive: () => boolean;
  readonly copied: () => typeof ClipboardIdentity.Type | undefined;
  readonly native: (
    notice: typeof NativeClipboardNotice.Type
  ) => Effect.Effect<void>;
  readonly notices: Stream.Stream<typeof ClipboardNotice.Type>;
  readonly personId: string;
  readonly sessionId: string;
}

interface HostedSession {
  readonly retire: Effect.Effect<void>;
  readonly dispatch: (
    action: typeof ClipboardAction.Type
  ) => Effect.Effect<void>;
  readonly personId: string;
  readonly sessionId: string;
}

const dispatchActor = (
  actor: EffectActor<typeof clipboardMachine>,
  action: typeof ClipboardAction.Type
) =>
  ClipboardAction.match(action, {
    Abandon: ({ intentId }) => send(actor, { intentId, type: "ABANDON" }),
    Cancel: ({ intentId }) => send(actor, { intentId, type: "CANCEL" }),
    DismissToast: ({ id }) => send(actor, { id, type: "DISMISS_TOAST" }),
    Guests: ({ choice, intentId }) =>
      send(actor, { choice, intentId, type: "GUESTS" }),
    Retry: ({ intentId }) => send(actor, { intentId, type: "RETRY" }),
  });

const clipboardActor = (personId: string) =>
  Effect.gen(function* startClipboardActor() {
    const actor = yield* createEffectActor(clipboardMachine, {
      input: { personId },
    });

    yield* watchActor("calendar.clipboard", actor);

    return actor;
  });

export class ClipboardRuntime extends Context.Service<
  ClipboardRuntime,
  {
    readonly connect: (
      personId: string
    ) => Effect.Effect<ClipboardConnection, never, Scope.Scope>;
    readonly dispatch: (
      personId: string,
      sessionId: string,
      action: typeof ClipboardAction.Type
    ) => Effect.Effect<void, ClipboardInputFailure>;
    readonly validateSession: (
      personId: string,
      sessionId: string
    ) => Effect.Effect<void, ClipboardInputFailure>;
  }
>()("@calendar/web/ClipboardRuntime") {
  static readonly layer = Layer.effect(
    ClipboardRuntime,
    Effect.gen(function* clipboardRuntime() {
      const client = yield* CalendarEditingClient;
      const crypto = yield* Crypto.Crypto;
      const writer = yield* DeletionWriter;
      const current = yield* Ref.make(Option.none<HostedSession>());

      const sessionFor = Effect.fn("ClipboardRuntime.session")(
        function* activeSession(personId: string, sessionId: string) {
          const active = yield* Ref.get(current);

          if (
            Option.isNone(active) ||
            active.value.personId !== personId ||
            active.value.sessionId !== sessionId
          ) {
            return yield* new ClipboardInputFailure({
              message: "The clipboard is not ready for this signed-in session.",
              reason: "personMismatch",
            });
          }

          return active.value;
        }
      );

      return ClipboardRuntime.of({
        connect: Effect.fn("ClipboardRuntime.connect")(function* connect(
          personId: string
        ) {
          const previous = yield* Ref.get(current);
          yield* Ref.set(current, Option.none());

          if (Option.isSome(previous)) {
            yield* previous.value.retire;
          }

          const sessionId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);

          const deletion = yield* DeletionSession.make().pipe(
            Effect.provideService(DeletionWriter, writer)
          );

          const actor = yield* clipboardActor(personId).pipe(
            Effect.provideService(CalendarEditingClient, client),
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.provideService(DeletionSession, deletion)
          );

          yield* send(actor, { sessionId, type: "ATTACH_NATIVE" });

          const session: HostedSession = {
            dispatch: (action) => dispatchActor(actor, action),
            personId,
            retire: send(actor, { type: "RETIRE" }).pipe(
              Effect.andThen(
                snapshots(actor).pipe(
                  Stream.filter((snapshot) => snapshot.status !== "active"),
                  Stream.runHead
                )
              ),
              Effect.asVoid
            ),
            sessionId,
          };

          yield* Ref.set(current, Option.some(session));
          yield* Effect.addFinalizer(() =>
            send(actor, { type: "RETIRE" }).pipe(
              Effect.andThen(
                Ref.update(current, (value) =>
                  Option.isSome(value) && value.value === session
                    ? Option.none()
                    : value
                )
              )
            )
          );
          const handledReceipt = yield* Ref.make(0);

          const notices = snapshots(actor).pipe(
            Stream.mapEffect((snapshot) =>
              Effect.gen(function* clipboardNotices() {
                if (snapshot.status === "error") {
                  return yield* Effect.die(snapshot.error);
                }

                const updates: (typeof ClipboardNotice.Type)[] = [
                  ClipboardNotice.cases.State.make({
                    view: projectClipboard(snapshot),
                  }),
                ];

                const { receipt } = snapshot.context;
                const handled = yield* Ref.get(handledReceipt);

                if (receipt !== undefined && receipt.revision > handled) {
                  yield* Ref.set(handledReceipt, receipt.revision);
                  updates.push(ClipboardNotice.cases.Receipt.make({ receipt }));
                }

                return updates;
              })
            ),
            Stream.flatMap((updates) => Stream.fromIterable(updates))
          );

          return {
            canReceive: () => {
              const snapshot = actor.getSnapshot();

              return (
                snapshot.status === "active" &&
                (snapshot.matches("empty") || snapshot.matches("ready"))
              );
            },
            copied: () => {
              const snapshot = actor.getSnapshot();
              const { envelope } = snapshot.context;

              return snapshot.status === "active" && envelope !== undefined
                ? { id: envelope.id, personId: envelope.personId }
                : undefined;
            },
            native: (notice) => send(actor, { notice, type: "NATIVE" }),
            notices,
            personId,
            sessionId,
          };
        }),
        dispatch: Effect.fn("ClipboardRuntime.dispatch")(function* dispatch(
          personId: string,
          sessionId: string,
          action: typeof ClipboardAction.Type
        ) {
          const active = yield* sessionFor(personId, sessionId);

          return yield* active.dispatch(action);
        }),
        validateSession: (personId, sessionId) =>
          sessionFor(personId, sessionId).pipe(Effect.asVoid),
      });
    })
  );
}
