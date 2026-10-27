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
import type { EffectActor } from "@xstate/effect";
import { Clock, Effect, Schema, Stream } from "effect";
import { types } from "xstate";
import type { EventFromLogic } from "xstate";

import { DesktopError } from "./config.js";
import {
  dismissAllPrompts,
  dismissPrompt,
  initialPrompt,
  presentedPrompts,
  promptBatchIdentity,
  promptIdentity,
  PromptInputAcknowledgement,
  PromptAdmissionPermit,
  PromptAdmissionSuperseded,
  reconcilePrompts,
  snoozePrompt,
} from "./prompt-model.js";
import type {
  PromptAdmissionPermitValue,
  PromptContext,
  PromptInput,
} from "./prompt-model.js";
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

const processedInput = (
  context: PromptContext,
  input: PromptInput,
  presenting: boolean,
  attempt: string | null,
  emit: (
    notice: typeof PromptInputAcknowledgement.Type & {
      readonly type: "InputProcessed";
    }
  ) => void
) => {
  const next = reconciled(
    context,
    {
      now: input.now,
      preferences: input.preferences,
      snapshot: input.snapshot,
    },
    presenting
  );

  const agenda = input.snapshot.notificationAgenda;

  emit({
    attempt,
    authority:
      agenda === undefined
        ? null
        : {
            lease: agenda.lease,
            personId: agenda.personId,
            revision: agenda.revision,
          },
    claims: next.context.pending.map((event) => ({
      key: event.key,
      start: event.start,
    })),
    type: "InputProcessed",
  });

  return next;
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

const promptRevisionIsNewer = (
  installed: PromptInput["snapshot"]["notificationAgenda"],
  requested: NonNullable<PromptInput["snapshot"]["notificationAgenda"]>
): boolean =>
  installed?.lease === requested.lease &&
  installed.personId === requested.personId &&
  installed.revision > requested.revision;

const admissionSuperseded = (
  installed: PromptInput["snapshot"]["notificationAgenda"],
  requested: PromptInput["snapshot"]["notificationAgenda"],
  permit: typeof PromptAdmissionPermit.Type
): boolean => {
  const main = permit.main ?? requested;

  return (
    !permit.active ||
    requested === undefined ||
    requested.personId === null ||
    main?.lease !== requested.lease ||
    main.personId !== requested.personId ||
    main.revision !== requested.revision ||
    (installed !== undefined &&
      installed.lease === requested.lease &&
      installed.personId === requested.personId &&
      installed.revision > requested.revision)
  );
};

export const promptMachine = (work: PromptWork) => {
  const present = createEffectLogic({
    effect: ({
      input,
    }: {
      readonly input: {
        readonly events: readonly AgendaEventValue[];
        readonly owner: PromptContext["visibleOwner"];
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
      emitted: { InputProcessed: PromptInputAcknowledgement },
      events: {
        AdmissionInput: Schema.Struct({
          attempt: Schema.String,
          now: Schema.Finite,
          permit: PromptAdmissionPermit,
          preferences: DesktopPreferences,
          snapshot: AgendaSnapshot,
        }),
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
      AdmissionInput: ({ context, event }, enqueue) =>
        event.permit.active &&
        !admissionSuperseded(
          context.snapshot.notificationAgenda,
          event.snapshot.notificationAgenda,
          event.permit
        )
          ? processedInput(context, event, false, event.attempt, (notice) => {
              enqueue.emit(notice);
            })
          : {},
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
      Input: ({ context, event }, enqueue) =>
        processedInput(context, event, false, null, (notice) => {
          enqueue.emit(notice);
        }),
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
            context: {
              ...context,
              pending: [],
              visible: [],
              visibleOwner: null,
            },
            target: "idle",
          }),
          onError: ({ context }) => ({
            context: {
              ...context,
              pending: [],
              visible: [],
              visibleOwner: null,
            },
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
            const authority = context.snapshot.notificationAgenda;

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
              owner:
                authority === undefined
                  ? null
                  : { lease: authority.lease, personId: authority.personId },
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
            context: {
              ...presentedPrompts(context),
              visibleOwner: event.output.owner,
            },
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
            context: {
              ...context,
              pending: [],
              visible: [],
              visibleOwner: null,
            },
            target: "closing",
          }),
          src: "present",
        },
        on: {
          AdmissionInput: ({ context, event }, enqueue) =>
            event.permit.active &&
            !admissionSuperseded(
              context.snapshot.notificationAgenda,
              event.snapshot.notificationAgenda,
              event.permit
            )
              ? processedInput(
                  context,
                  event,
                  true,
                  event.attempt,
                  (notice) => {
                    enqueue.emit(notice);
                  }
                )
              : {},
          Agenda: ({ context, event }) =>
            reconciled(context, { snapshot: event.snapshot }, true),
          Dismiss: ({ context, event }) => ({
            context: dismissPrompt(context, event.key, context.pending),
            reenter: true,
            target: "#desktopPrompt.evaluating",
          }),
          Input: ({ context, event }, enqueue) =>
            processedInput(context, event, true, null, (notice) => {
              enqueue.emit(notice);
            }),
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

export const preparePromptAdmission = Effect.fn(
  "Desktop.preparePromptAdmission"
)(function* preparePromptAdmission(
  actor: EffectActor<ReturnType<typeof promptMachine>>,
  input: PromptInput,
  attempt: string,
  admission?: PromptAdmissionPermitValue,
  settlement: "processed" | "presented" = "processed"
) {
  const agenda = input.snapshot.notificationAgenda;

  if (agenda === undefined || agenda.personId === null) {
    return yield* new DesktopError({
      message: "Prompt admission authority is unavailable",
    });
  }

  const initial = actor.getSnapshot().context.snapshot.notificationAgenda;

  const permit = admission ?? { active: true, main: agenda };

  if (admissionSuperseded(initial, agenda, permit)) {
    return yield* permit.active &&
    permit.main?.lease === agenda.lease &&
    permit.main.personId === agenda.personId &&
    permit.main.revision === agenda.revision &&
    promptRevisionIsNewer(initial, agenda)
      ? new PromptAdmissionSuperseded({
          message: "A newer publication superseded admission",
        })
      : new DesktopError({
          message: "Prompt admission authority is unavailable",
        });
  }

  const sameAuthority = (
    authority: (typeof PromptInputAcknowledgement.Type)["authority"]
  ) =>
    authority !== null &&
    authority.lease === agenda.lease &&
    authority.personId === agenda.personId &&
    authority.revision === agenda.revision;

  return yield* Effect.callback<
    (typeof PromptInputAcknowledgement.Type)["claims"],
    DesktopError | PromptAdmissionSuperseded
  >((resume) => {
    let settled = false;
    let processed: typeof PromptInputAcknowledgement.Type | undefined;
    const initialContext = actor.getSnapshot().context;
    const subscriptions = new Set<{ unsubscribe: () => void }>();

    const cleanup = () => {
      permit.active = false;

      for (const subscription of subscriptions) {
        subscriptions.delete(subscription);
        subscription.unsubscribe();
      }
    };

    const track = (subscription: { unsubscribe: () => void }) => {
      if (settled) {
        subscription.unsubscribe();
      } else {
        subscriptions.add(subscription);
      }
    };

    const settle = (
      result: Effect.Effect<
        (typeof PromptInputAcknowledgement.Type)["claims"],
        DesktopError | PromptAdmissionSuperseded
      >
    ) => {
      if (!settled) {
        settled = true;
        cleanup();
        resume(result);
      }
    };

    const refuse = () => {
      settle(
        Effect.fail(
          new DesktopError({
            message: "Prompt admission was superseded or stopped",
          })
        )
      );
    };

    const settleOwnership = (
      snapshot: ReturnType<typeof actor.getSnapshot>
    ) => {
      if (
        processed === undefined ||
        snapshot.context === initialContext ||
        !sameAuthority(snapshot.context.snapshot.notificationAgenda ?? null)
      ) {
        return;
      }

      const ownsVisible =
        snapshot.context.visibleOwner?.lease === agenda.lease &&
        snapshot.context.visibleOwner.personId === agenda.personId;

      const claims = processed.claims.filter(
        (claim) =>
          ownsVisible &&
          snapshot.context.visible.some(
            (event) =>
              promptIdentity(event.key) === promptIdentity(claim.key) &&
              event.start === claim.start
          )
      );

      if (
        snapshot.matches("visible") ||
        snapshot.matches("idle") ||
        snapshot.matches("closing") ||
        (ownsVisible && claims.length === processed.claims.length)
      ) {
        settle(Effect.succeed(claims));
      }
    };

    track(
      actor.on("InputProcessed", (acknowledgement) => {
        if (settled || acknowledgement.attempt !== attempt) {
          return;
        }

        if (!sameAuthority(acknowledgement.authority)) {
          refuse();

          return;
        }

        if (settlement === "processed" || acknowledgement.claims.length === 0) {
          settle(Effect.succeed(acknowledgement.claims));
        } else {
          processed = acknowledgement;
          settleOwnership(actor.getSnapshot());
        }
      })
    );

    track(
      actor.subscribe({
        complete: refuse,
        error: refuse,
        next: (snapshot) => {
          const current = snapshot.context.snapshot.notificationAgenda;

          const unchanged =
            current?.lease === initial?.lease &&
            current?.personId === initial?.personId &&
            current?.revision === initial?.revision;

          if (
            snapshot.status !== "active" ||
            (!unchanged && !sameAuthority(current ?? null))
          ) {
            if (
              snapshot.status === "active" &&
              promptRevisionIsNewer(current, agenda)
            ) {
              settle(
                Effect.fail(
                  new PromptAdmissionSuperseded({
                    message: "A newer prompt publication superseded admission",
                  })
                )
              );
            } else {
              refuse();
            }
          } else if (settlement === "presented") {
            settleOwnership(snapshot);
          }
        },
      })
    );

    if (!settled) {
      if (actor.getSnapshot().status === "active") {
        actor.send({ ...input, attempt, permit, type: "AdmissionInput" });
      } else {
        refuse();
      }
    }

    return Effect.sync(() => {
      settled = true;
      cleanup();
    });
  });
});

export const startPrompt = Effect.fn("Desktop.startPrompt")(
  function* startPrompt(work: PromptWork, input: PromptInput) {
    const actor = yield* createEffectActor(promptMachine(work), { input });
    yield* watchActor("desktopPrompt", actor);

    return actor;
  }
);
