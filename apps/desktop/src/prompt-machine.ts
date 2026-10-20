import { watchActor } from "@calendar/capability/actor-watch";
import {
  AgendaKey,
  AgendaSnapshot,
  DesktopPreferences,
} from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import {
  createEffectActor,
  createEffectLogic,
  setupEffect,
} from "@xstate/effect";
import { Effect, Schema } from "effect";
import { types } from "xstate";
import type { EventFromLogic } from "xstate";

import type { DesktopError } from "./config.js";
import {
  dismissAllPrompts,
  dismissPrompt,
  initialPrompt,
  presentedPrompts,
  reconcilePrompts,
} from "./prompt-model.js";
import type { PromptContext, PromptInput } from "./prompt-model.js";

export interface PromptWork {
  readonly close: Effect.Effect<void, DesktopError>;
  readonly present: (
    events: readonly AgendaEventValue[]
  ) => Effect.Effect<void, DesktopError>;
}

export const promptMachine = (work: PromptWork) => {
  const present = createEffectLogic({
    effect: ({ input }: { readonly input: readonly AgendaEventValue[] }) =>
      work.present(input),
  });

  const close = createEffectLogic({ effect: work.close });

  return setupEffect({
    actors: { close, present },
    schemas: {
      context: types<PromptContext>(),
      events: {
        Agenda: Schema.Struct({ snapshot: AgendaSnapshot }),
        Closed: Schema.Struct({}),
        Dismiss: Schema.Struct({ key: AgendaKey }),
        Input: Schema.Struct({
          now: Schema.Finite,
          preferences: DesktopPreferences,
          snapshot: AgendaSnapshot,
        }),
        Settings: Schema.Struct({ preferences: DesktopPreferences }),
        Tick: Schema.Struct({ now: Schema.Finite }),
      },
      input: types<PromptInput>(),
    },
  }).createMachine({
    context: ({ input }) => reconcilePrompts(initialPrompt(input), {}),
    initial: "evaluating",
    on: {
      Agenda: ({ context, event }) => ({
        context: reconcilePrompts(context, { snapshot: event.snapshot }),
        reenter: true,
        target: ".evaluating",
      }),
      Closed: ({ context }) => ({
        context: dismissAllPrompts(context),
        target: ".idle",
      }),
      Dismiss: ({ context, event }) => ({
        context: dismissPrompt(context, event.key),
        reenter: true,
        target: ".evaluating",
      }),
      Input: ({ context, event }) => ({
        context: reconcilePrompts(context, {
          now: event.now,
          preferences: event.preferences,
          snapshot: event.snapshot,
        }),
        reenter: true,
        target: ".evaluating",
      }),
      Settings: ({ context, event }) => ({
        context: reconcilePrompts(context, { preferences: event.preferences }),
        reenter: true,
        target: ".evaluating",
      }),
      Tick: ({ context, event }) => ({
        context: reconcilePrompts(context, { now: event.now }),
        reenter: true,
        target: ".evaluating",
      }),
    },
    states: {
      closing: {
        invoke: {
          onDone: ({ context }) => ({
            context: { ...context, pending: [], visible: [] },
            target: "idle",
          }),
          onError: ({ context }) => ({
            context: { ...context, pending: [], visible: [] },
            target: "idle",
          }),
          src: "close",
        },
      },
      evaluating: {
        always: ({ context }) => ({
          target: context.pending.length > 0 ? "presenting" : "closing",
        }),
      },
      idle: {},
      presenting: {
        invoke: {
          input: ({ context }) => context.pending,
          onDone: ({ context }) => ({
            context: presentedPrompts(context),
            target: "visible",
          }),
          onError: ({ context }) => ({
            context: { ...context, pending: [], visible: [] },
            target: "closing",
          }),
          src: "present",
        },
      },
      visible: {},
    },
  });
};

export type PromptEvent = EventFromLogic<ReturnType<typeof promptMachine>>;

export const startPrompt = Effect.fn("Desktop.startPrompt")(
  function* startPrompt(work: PromptWork, input: PromptInput) {
    const actor = yield* createEffectActor(promptMachine(work), { input });
    yield* watchActor("desktopPrompt", actor);

    return actor;
  }
);
