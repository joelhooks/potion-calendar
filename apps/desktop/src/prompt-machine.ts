import { watchActor } from "@calendar/capability/actor-watch";
import {
  AgendaKey,
  AgendaSnapshot,
  DesktopPreferences,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  PromptSound,
} from "@calendar/core/desktop-bridge";
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
  promptBatchIdentity,
  promptIdentity,
  reconcilePrompts,
} from "./prompt-model.js";
import type { PromptContext, PromptInput } from "./prompt-model.js";

export interface PromptPresentation {
  readonly reveal: boolean;
  readonly sound: typeof PromptSound.Type;
}

const reconciled = (
  context: PromptContext,
  input: Partial<PromptInput>,
  presenting: boolean
) => {
  const next = reconcilePrompts(
    context,
    input,
    presenting ? context.pending : context.visible
  );

  return presenting &&
    next.preferences.promptSound === context.preferences.promptSound &&
    promptBatchIdentity(next.pending) === promptBatchIdentity(context.pending)
    ? { context: next }
    : { context: next, reenter: true, target: "#desktopPrompt.evaluating" };
};

export interface PromptWork {
  readonly close: Effect.Effect<void, DesktopError>;
  readonly present: (
    events: readonly AgendaEventValue[],
    presentation: PromptPresentation
  ) => Effect.Effect<void, DesktopError>;
}

export const promptMachine = (work: PromptWork) => {
  const present = createEffectLogic({
    effect: ({
      input,
    }: {
      readonly input: {
        readonly events: readonly AgendaEventValue[];
        readonly presentation: PromptPresentation;
      };
    }) =>
      work
        .present(input.events, input.presentation)
        .pipe(Effect.as(input.events)),
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
    id: "desktopPrompt",
    initial: "evaluating",
    on: {
      Agenda: ({ context, event }) =>
        reconciled(context, { snapshot: event.snapshot }, false),
      Closed: ({ context }) => ({
        context: dismissAllPrompts(context),
        target: ".idle",
      }),
      Dismiss: ({ context, event }) => ({
        context: dismissPrompt(context, event.key),
        reenter: true,
        target: ".evaluating",
      }),
      Input: ({ context, event }) =>
        reconciled(
          context,
          {
            now: event.now,
            preferences: event.preferences,
            snapshot: event.snapshot,
          },
          false
        ),
      Settings: ({ context, event }) =>
        reconciled(context, { preferences: event.preferences }, false),
      Tick: ({ context, event }) =>
        reconciled(context, { now: event.now }, false),
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
          input: ({ context }) => {
            const reveal = context.pending.some(
              (event) =>
                !context.visible.some(
                  (previous) =>
                    promptIdentity(previous.key) ===
                      promptIdentity(event.key) &&
                    previous.start === event.start
                )
            );

            return {
              events: context.pending,
              presentation: {
                reveal,
                sound: reveal ? context.preferences.promptSound : "none",
              },
            };
          },
          onDone: ({ context, event }) => ({
            context: presentedPrompts(context),
            target:
              JSON.stringify(context.pending) === JSON.stringify(event.output)
                ? "visible"
                : "evaluating",
          }),
          onError: ({ context }) => ({
            context: { ...context, pending: [], visible: [] },
            target: "closing",
          }),
          src: "present",
        },
        on: {
          Agenda: ({ context, event }) =>
            reconciled(context, { snapshot: event.snapshot }, true),
          Dismiss: ({ context, event }) => ({
            context: dismissPrompt(context, event.key, context.pending),
            reenter: true,
            target: "#desktopPrompt.evaluating",
          }),
          Input: ({ context, event }) =>
            reconciled(
              context,
              {
                now: event.now,
                preferences: event.preferences,
                snapshot: event.snapshot,
              },
              true
            ),
          Settings: ({ context, event }) =>
            reconciled(context, { preferences: event.preferences }, true),
          Tick: ({ context, event }) =>
            reconciled(context, { now: event.now }, true),
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
