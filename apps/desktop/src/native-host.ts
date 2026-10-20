import { watchActor } from "@calendar/capability/actor-watch";
import {
  AgendaKey,
  AgendaSnapshot,
  DesktopAction,
  DesktopSettings,
  MeetingJoinRequest,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaSnapshotValue,
  DesktopPreferencesValue,
} from "@calendar/core/desktop-bridge";
import {
  createEffectActor,
  createEffectEventStreamLogic,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Clock, Effect, Option, Predicate, Schema, Stream } from "effect";
import { types } from "xstate";
import type { EventFromLogic } from "xstate";

import type { DesktopError } from "./config.js";

export const NativeIntent = Schema.TaggedUnion({
  ClosedPrompt: {},
  DismissPrompt: { key: AgendaKey },
  Join: { request: MeetingJoinRequest },
  MenuState: { value: Schema.Literals(["open", "closed"]) },
  OpenSettings: { page: DesktopAction.cases.OpenSettings.fields.page },
  OpenWindow: {},
  Quit: {},
  RequestedJoinMeeting: {},
  ShowEvent: { key: AgendaKey },
  Stop: {},
  ToggleMenu: {},
});

export type NativeIntentValue = typeof NativeIntent.Type;

export interface NativeView {
  readonly agenda: AgendaSnapshotValue;
  readonly menuState: "open" | "closed";
  readonly now: number;
  readonly preferences: DesktopPreferencesValue;
}

interface HostContext extends NativeView {
  readonly intent: Option.Option<NativeIntentValue>;
  readonly queued: readonly NativeIntentValue[];
  readonly settingsRevision: number;
}

export interface NativeHostWork {
  readonly intents: Stream.Stream<NativeIntentValue>;
  readonly perform: (
    intent: NativeIntentValue,
    view: NativeView
  ) => Effect.Effect<void, DesktopError>;
  readonly render: (view: NativeView) => Effect.Effect<void, DesktopError>;
}

export const nativeHostMachine = (work: NativeHostWork) => {
  const clock = createEffectEventStreamLogic(
    Stream.fromEffectRepeat(
      Effect.gen(function* minuteTick() {
        const now = yield* Clock.currentTimeMillis;
        yield* Effect.sleep((Math.floor(now / 60_000) + 1) * 60_000 - now);

        return { now: yield* Clock.currentTimeMillis, type: "Tick" };
      })
    )
  );

  const intents = createEffectEventStreamLogic(
    work.intents.pipe(
      Stream.map(
        (
          intent
        ):
          | { readonly type: "Quit" }
          | { readonly type: "MenuState"; readonly value: "open" | "closed" }
          | { readonly type: "Intent"; readonly intent: NativeIntentValue } => {
          if (Predicate.isTagged(intent, "Stop")) {
            return { type: "Quit" };
          }

          if (Predicate.isTagged(intent, "MenuState")) {
            return { type: "MenuState", value: intent.value };
          }

          return { intent, type: "Intent" };
        }
      )
    )
  );

  const render = createEffectLogic({
    effect: ({ input }: { readonly input: NativeView }) => work.render(input),
  });

  const perform = createEffectLogic({
    effect: ({
      input,
    }: {
      readonly input: {
        readonly intent: NativeIntentValue;
        readonly view: NativeView;
      };
    }) => work.perform(input.intent, input.view),
  });

  return setupEffect({
    actors: { clock, intents, perform, render },
    schemas: {
      context: types<HostContext>(),
      events: {
        Agenda: Schema.Struct({ snapshot: AgendaSnapshot }),
        Intent: Schema.Struct({ intent: NativeIntent }),
        MenuState: Schema.Struct({
          value: Schema.Literals(["open", "closed"]),
        }),
        Quit: Schema.Struct({}),
        Settings: Schema.Struct({ settings: DesktopSettings }),
        Tick: Schema.Struct({ now: Schema.Finite }),
      },
      input: types<Pick<NativeView, "now" | "preferences">>(),
    },
  }).createMachine({
    context: ({ input }) => ({
      ...input,
      agenda: { events: [] },
      intent: Option.none(),
      menuState: "closed",
      queued: [],
      settingsRevision: -1,
    }),
    initial: "active",
    on: { Quit: { target: ".stopped" } },
    states: {
      active: {
        initial: "rendering",
        invoke: [{ src: "clock" }, { src: "intents" }],
        on: {
          Agenda: ({ event }) => ({ context: { agenda: event.snapshot } }),
          Intent: ({ context, event }) => ({
            context: {
              queued: [
                ...context.queued.filter(
                  (queued) => queued._tag !== event.intent._tag
                ),
                event.intent,
              ],
            },
          }),
          MenuState: ({ event }) => ({ context: { menuState: event.value } }),
          Settings: ({ context, event }) =>
            event.settings.revision > context.settingsRevision
              ? {
                  context: {
                    preferences: event.settings.preferences,
                    settingsRevision: event.settings.revision,
                  },
                }
              : {},
          Tick: ({ event }) => ({ context: { now: event.now } }),
        },
        states: {
          acting: {
            invoke: {
              input: ({ context }) => ({
                intent: Option.getOrThrow(context.intent),
                view: context,
              }),
              onDone: {
                context: { intent: Option.none() },
                target: "dispatching",
              },
              onError: {
                context: { intent: Option.none() },
                target: "dispatching",
              },
              src: "perform",
            },
          },
          dispatching: {
            always: ({ context }) => {
              const [next] = context.queued;

              return next === undefined
                ? { target: "rendering" }
                : {
                    context: {
                      intent: Option.some(next),
                      queued: context.queued.slice(1),
                    },
                    target: "acting",
                  };
            },
          },
          idle: {
            on: {
              Agenda: ({ event }) => ({
                context: { agenda: event.snapshot },
                target: "rendering",
              }),
              Intent: ({ event }) => ({
                context: { intent: Option.some(event.intent) },
                target: "acting",
              }),
              Settings: ({ context, event }) =>
                event.settings.revision > context.settingsRevision
                  ? {
                      context: {
                        preferences: event.settings.preferences,
                        settingsRevision: event.settings.revision,
                      },
                      target: "rendering",
                    }
                  : {},
              Tick: ({ event }) => ({
                context: { now: event.now },
                target: "rendering",
              }),
            },
          },
          rendering: {
            invoke: {
              input: ({ context }) => context,
              onDone: { target: "idle" },
              onError: { target: "idle" },
              src: "render",
            },
            on: {
              Agenda: ({ event }) => ({
                context: { agenda: event.snapshot },
                reenter: true,
                target: "rendering",
              }),
              Intent: ({ event }) => ({
                context: { intent: Option.some(event.intent) },
                target: "acting",
              }),
              Settings: ({ context, event }) =>
                event.settings.revision > context.settingsRevision
                  ? {
                      context: {
                        preferences: event.settings.preferences,
                        settingsRevision: event.settings.revision,
                      },
                      reenter: true,
                      target: "rendering",
                    }
                  : {},
              Tick: ({ event }) => ({
                context: { now: event.now },
                reenter: true,
                target: "rendering",
              }),
            },
          },
        },
      },
      stopped: { type: "final" },
    },
  });
};

export type NativeHostEvent = EventFromLogic<
  ReturnType<typeof nativeHostMachine>
>;

export const startNativeHost = Effect.fn("Desktop.startNativeHost")(
  function* startNativeHost(
    work: NativeHostWork,
    input: Pick<NativeView, "now" | "preferences">
  ) {
    const actor = yield* createEffectActor(nativeHostMachine(work), { input });
    yield* watchActor("desktopHost", actor);

    return {
      actor,
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Declared actor failures remain local states; an unexpected host-machine defect must stop the native scope.
      done: join(actor).pipe(Effect.orDie),
    };
  }
);
