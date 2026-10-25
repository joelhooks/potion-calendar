import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import {
  Context,
  Deferred,
  Effect,
  Option,
  Queue,
  Schema,
  Stream,
} from "effect";
import type { Cause } from "effect";

import { LiveFrame, LiveNotice } from "./protocol.js";
import type { LiveNoticeValue } from "./protocol.js";
import { clearEndedSessionStorage, liveSessionExists } from "./session.js";

const SocketClosure = Schema.Struct({
  code: Schema.Int,
  connected: Schema.Boolean,
  reason: Schema.String,
});

export interface LiveSocket {
  readonly addEventListener: WebSocket["addEventListener"];
  readonly removeEventListener: WebSocket["removeEventListener"];
  readonly close: WebSocket["close"];
}

class SocketSession extends Context.Service<
  SocketSession,
  {
    readonly observe: Effect.Effect<typeof SocketClosure.Type>;
    readonly sessionExists: Effect.Effect<boolean>;
    readonly end: (deleted: boolean) => Effect.Effect<void>;
  }
>()("@calendar/web/SocketSession") {}

const observe = createEffectLogic({
  effect: SocketSession.use((service) => service.observe),
});

const reconnect = createEffectLogic({
  effect: ({ input }) =>
    Effect.sleep(Math.min(30_000, 1000 * 2 ** input.attempts)),
  schemas: { input: Schema.Struct({ attempts: Schema.Int }) },
});

const checkSession = createEffectLogic({
  effect: SocketSession.use((service) => service.sessionExists),
});

const endSession = createEffectLogic({
  effect: ({ input }) =>
    SocketSession.use((service) => service.end(input.deleted)),
  schemas: { input: Schema.Struct({ deleted: Schema.Boolean }) },
});

export const liveSocketMachine = setupEffect({
  actors: { checkSession, endSession, observe, reconnect },
  schemas: {
    context: Schema.Struct({ attempts: Schema.Int, deleted: Schema.Boolean }),
  },
}).createMachine({
  context: { attempts: 0, deleted: false },
  initial: "observing",
  states: {
    checkingSession: {
      invoke: {
        onDone: ({ event }) => ({
          target: event.output ? "retrying" : "ending",
        }),
        src: "checkSession",
      },
    },
    ended: { type: "final" },
    ending: {
      invoke: {
        input: ({ context }) => ({ deleted: context.deleted }),
        onDone: { target: "ended" },
        src: "endSession",
      },
    },
    observing: {
      invoke: {
        onDone: ({ context, event }) => ({
          context: {
            attempts: event.output.connected
              ? 0
              : Math.min(5, context.attempts + 1),
            deleted:
              event.output.code === 1008 &&
              event.output.reason === "Account deleted",
          },
          target:
            event.output.code === 1008 || !event.output.connected
              ? "checkingSession"
              : "retrying",
        }),
        src: "observe",
      },
    },
    retrying: {
      invoke: {
        input: ({ context }) => context,
        onDone: { target: "observing" },
        src: "reconnect",
      },
    },
  },
});

const browserSocket = (): LiveSocket => {
  const url = new URL("/live", window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  return new WebSocket(url);
};

const receiveLiveFrame =
  (queue: Queue.Enqueue<LiveNoticeValue, Cause.Done>) =>
  (event: MessageEvent) => {
    const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(LiveFrame))(
      event.data
    );

    if (Option.isNone(parsed)) {
      return;
    }

    Queue.offerUnsafe(
      queue,
      "_tag" in parsed.value
        ? LiveNotice.cases.InventoryChanged.make({})
        : LiveNotice.cases.CalendarChanged.make({ change: parsed.value })
    );
  };

export const liveSocketStream = (
  personId: string,
  connect: () => LiveSocket = browserSocket,
  sessionExists: Effect.Effect<boolean> = liveSessionExists
): Stream.Stream<LiveNoticeValue> =>
  Stream.callback<LiveNoticeValue>((queue) =>
    Effect.gen(function* liveObserver() {
      const message = receiveLiveFrame(queue);

      const observeSocket = Effect.gen(function* observeConnection() {
        const ended = yield* Deferred.make<typeof SocketClosure.Type>();
        let connected = false;

        const opened = () => {
          connected = true;
          Queue.offerUnsafe(queue, LiveNotice.cases.Reconnected.make({}));
        };

        const closed = (event: CloseEvent) => {
          Deferred.doneUnsafe(
            ended,
            Effect.succeed({
              code: event.code,
              connected,
              reason: event.reason,
            })
          );
        };

        const failed = () => {
          Deferred.doneUnsafe(
            ended,
            Effect.succeed({ code: 1006, connected, reason: "" })
          );
        };

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const socket = connect();
            socket.addEventListener("open", opened);
            socket.addEventListener("close", closed);
            socket.addEventListener("error", failed);
            socket.addEventListener("message", message);

            return socket;
          }),
          (socket) =>
            Effect.sync(() => {
              socket.removeEventListener("open", opened);
              socket.removeEventListener("close", closed);
              socket.removeEventListener("error", failed);
              socket.removeEventListener("message", message);
              socket.close();
            })
        );

        return yield* Deferred.await(ended);
      }).pipe(Effect.scoped);

      yield* Effect.gen(function* observeSocketMachine() {
        const actor = yield* createEffectActor(liveSocketMachine);
        yield* watchActor("calendarLiveSocket", actor);
        // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- An unexpected socket actor crash is a defect, never a provider failure.
        yield* join(actor).pipe(Effect.orDie);
      }).pipe(
        Effect.provideService(SocketSession, {
          end: (deleted) =>
            Effect.gen(function* endLiveSession() {
              yield* clearEndedSessionStorage(personId);
              yield* Queue.offer(
                queue,
                LiveNotice.cases.SessionEnded.make({ deleted })
              );
            }),
          observe: observeSocket,
          sessionExists,
        })
      );
      yield* Queue.end(queue);
    })
  );

export const noticeAffectsSelection = (
  notice: LiveNoticeValue,
  calendars: readonly {
    readonly accountId: string;
    readonly calendarId: string;
  }[]
) =>
  !LiveNotice.guards.CalendarChanged(notice) ||
  calendars.some(
    (calendar) =>
      calendar.accountId === notice.change.accountId &&
      calendar.calendarId === notice.change.calendarId
  );
