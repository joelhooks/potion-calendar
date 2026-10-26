import { watchActor } from "@calendar/capability/actor-watch";
import {
  AgendaKey,
  AgendaSnapshot,
  DesktopPreferences,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  PromptPreferences,
  PromptSound,
} from "@calendar/core/desktop-bridge";
import {
  createEffectActor,
  createEffectEventStreamLogic,
  createEffectLogic,
  setupEffect,
} from "@xstate/effect";
import { Clock, Effect, Schema, Stream } from "effect";
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
  snoozePrompt,
} from "./prompt-model.js";
import type { PromptContext, PromptInput } from "./prompt-model.js";
import { projectPromptPreferences } from "./prompt-preferences.js";

export interface PromptPresentation {
  readonly preferences?: typeof PromptPreferences.Type | undefined;
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

const snoozed = (
  context: PromptContext,
  key: AgendaEventValue["key"],
  now: number,
  retained: readonly AgendaEventValue[] = context.visible
) => {
  const next = snoozePrompt(context, key, now, retained);

  return next === context
    ? {}
    : { context: next, reenter: true, target: "#desktopPrompt" };
};

export const promptMachine = (work: PromptWork) => {
  const present = createEffectLogic({
    effect: ({
      input,
    }: {
      readonly input: {
        readonly events: readonly AgendaEventValue[];
        readonly presentation: PromptPresentation;
      };
    }) => work.present(input.events, input.presentation).pipe(Effect.as(input)),
  });

  const close = createEffectLogic({ effect: work.close });

  const snoozeClock = createEffectEventStreamLogic(
    ({ input }: { readonly input: readonly number[] }) =>
      Stream.fromIterable(input).pipe(
        Stream.mapEffect((until) =>
          Effect.gen(function* waitForSnooze() {
            const now = yield* Clock.currentTimeMillis;
            yield* Effect.sleep(Math.max(0, until - now));

            return { now: yield* Clock.currentTimeMillis, type: "Tick" };
          })
        )
      )
  );

  return setupEffect({
    actors: { close, present, snoozeClock },
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
        Snooze: Schema.Struct({ key: AgendaKey, now: Schema.Finite }),
        Tick: Schema.Struct({ now: Schema.Finite }),
      },
      input: types<PromptInput>(),
    },
  }).createMachine({
    context: ({ input }) => reconcilePrompts(initialPrompt(input), {}),
    id: "desktopPrompt",
    initial: "evaluating",
    invoke: {
      input: ({ context }) =>
        [
          ...new Set(
            [...context.snoozed.values()].map((snooze) => snooze.until)
          ),
        ].toSorted((a, b) => a - b),
      src: "snoozeClock",
    },
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
      Snooze: ({ context, event }) => snoozed(context, event.key, event.now),
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
                preferences: projectPromptPreferences(
                  context.snapshot,
                  context.preferences
                ),
                reveal,
                sound: reveal ? context.preferences.promptSound : "none",
              },
            };
          },
          onDone: ({ context, event }) => ({
            context: presentedPrompts(context),
            target:
              JSON.stringify({
                events: context.pending,
                preferences: projectPromptPreferences(
                  context.snapshot,
                  context.preferences
                ),
              }) ===
              JSON.stringify({
                events: event.output.events,
                preferences: event.output.presentation.preferences,
              })
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
          Snooze: ({ context, event }) =>
            snoozed(context, event.key, event.now, context.pending),
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
