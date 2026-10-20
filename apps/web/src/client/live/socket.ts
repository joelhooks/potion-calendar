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

export interface LiveSocket {
  readonly addEventListener: WebSocket["addEventListener"];
  readonly removeEventListener: WebSocket["removeEventListener"];
  readonly close: WebSocket["close"];
}

class SocketSession extends Context.Service<
  SocketSession,
  { readonly observe: Effect.Effect<boolean> }
>()("@calendar/web/SocketSession") {}

const observe = createEffectLogic({
  effect: SocketSession.use((service) => service.observe),
});

const reconnect = createEffectLogic({
  effect: ({ input }) =>
    Effect.sleep(Math.min(30_000, 1000 * 2 ** input.attempts)),
  schemas: { input: Schema.Struct({ attempts: Schema.Int }) },
});

export const liveSocketMachine = setupEffect({
  actors: { observe, reconnect },
  schemas: { context: Schema.Struct({ attempts: Schema.Int }) },
}).createMachine({
  context: { attempts: 0 },
  initial: "observing",
  states: {
    observing: {
      invoke: {
        onDone: {
          context: ({ context, event }) => ({
            attempts: event.output ? 0 : Math.min(5, context.attempts + 1),
          }),
          target: "retrying",
        },
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
  connect: () => LiveSocket = browserSocket
): Stream.Stream<LiveNoticeValue> =>
  Stream.callback<LiveNoticeValue>((queue) =>
    Effect.gen(function* liveObserver() {
      const message = receiveLiveFrame(queue);

      const observeSocket = Effect.gen(function* observeConnection() {
        const ended = yield* Deferred.make<boolean>();
        let connected = false;

        const opened = () => {
          connected = true;
          Queue.offerUnsafe(queue, LiveNotice.cases.Reconnected.make({}));
        };

        const closed = () => {
          Deferred.doneUnsafe(ended, Effect.succeed(connected));
        };

        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const socket = connect();
            socket.addEventListener("open", opened);
            socket.addEventListener("close", closed);
            socket.addEventListener("error", closed);
            socket.addEventListener("message", message);

            return socket;
          }),
          (socket) =>
            Effect.sync(() => {
              socket.removeEventListener("open", opened);
              socket.removeEventListener("close", closed);
              socket.removeEventListener("error", closed);
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
      }).pipe(Effect.provideService(SocketSession, { observe: observeSocket }));
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
