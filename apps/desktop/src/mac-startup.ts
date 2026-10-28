import { watchActor } from "@calendar/capability/actor-watch";
import type { DesktopSettingsValue } from "@calendar/core/desktop-bridge";
import {
  createEffectActor,
  createEffectLogic,
  send,
  setupEffect,
} from "@xstate/effect";
import { Effect, Schema } from "effect";
import { types } from "xstate";

import type { DesktopError } from "./config.js";

export const trayOnlyKeepsHiddenRenderer = Object.freeze({
  hidden: true,
  label: "desk default (spec silent)",
});

export const unknownOrStaleLoginShows = Object.freeze({
  hidden: false,
  label: "desk default (spec silent)",
});

export const preserveDisabledChoice = Object.freeze({
  label: "desk default (spec silent)",
  menuIntent: "retained",
});

export const featureOffCancelsTrayOnlyRegistration = Object.freeze({
  label: "desk default (spec silent)",
  passiveRegistration: false,
});

export const MacLaunchDecision = Schema.Struct({
  hidden: Schema.Boolean,
  issue: Schema.NullOr(Schema.String),
});

export const macLaunchDecision = (
  openedAtLogin: boolean,
  settings: DesktopSettingsValue
): typeof MacLaunchDecision.Type => {
  if (!openedAtLogin) {
    return { hidden: false, issue: null };
  }

  if (settings.openAtLogin && settings.macStartup?.calendar === true) {
    return { hidden: false, issue: null };
  }

  if (
    settings.openAtLogin &&
    settings.preferences.menuBar &&
    settings.macStartup?.menuBar === true
  ) {
    return { hidden: trayOnlyKeepsHiddenRenderer.hidden, issue: null };
  }

  return {
    hidden: unknownOrStaleLoginShows.hidden,
    issue:
      "This login launch has no eligible startup mode. The calendar window is shown.",
  };
};

export interface MacStartupPort {
  readonly read: Effect.Effect<typeof MacLaunchDecision.Type, DesktopError>;
  readonly report: (message: string) => Effect.Effect<void>;
  readonly show: Effect.Effect<void>;
}

interface MacStartupContext {
  readonly port: MacStartupPort;
  readonly readiness: "waiting" | "ready";
}

export const macStartupMachine = () => {
  const read = createEffectLogic({
    effect: ({ input }: { readonly input: MacStartupPort }) =>
      input.read.pipe(
        // oxlint-disable-next-line promise/prefer-await-to-then -- Effect.catch handles the typed startup read failure, not a Promise.
        Effect.catch(() =>
          Effect.succeed(
            MacLaunchDecision.make({
              hidden: unknownOrStaleLoginShows.hidden,
              issue:
                "Startup settings could not be read. The calendar window is shown.",
            })
          )
        ),
        Effect.tap((decision) =>
          decision.issue === null ? Effect.void : input.report(decision.issue)
        )
      ),
    schemas: { input: types<MacStartupPort>() },
  });

  const show = createEffectLogic({
    effect: ({ input }: { readonly input: MacStartupPort }) => input.show,
    schemas: { input: types<MacStartupPort>() },
  });

  return setupEffect({
    actors: { read, show },
    schemas: {
      context: types<MacStartupContext>(),
      events: { Open: Schema.Struct({}), Ready: Schema.Struct({}) },
      input: types<MacStartupPort>(),
    },
  }).createMachine({
    context: ({ input }): MacStartupContext => ({
      port: input,
      readiness: "waiting",
    }),
    id: "macStartup",
    initial: "reading",
    on: {
      Open: { reenter: true, target: ".showing" },
    },
    states: {
      hidden: {},
      reading: {
        invoke: {
          input: ({ context }) => context.port,
          onDone: ({ context, event }) => {
            if (context.readiness === "ready") {
              return { target: event.output.hidden ? "hidden" : "showing" };
            }

            return {
              target: event.output.hidden ? "waitingHidden" : "waitingShown",
            };
          },
          src: "read",
        },
        on: {
          Ready: ({ context }) => ({
            context: {
              ...context,
              readiness: Schema.Literal("ready").make("ready"),
            },
          }),
        },
      },
      showing: {
        invoke: {
          input: ({ context }) => context.port,
          onDone: { target: "shown" },
          src: "show",
        },
      },
      shown: {},
      waitingHidden: { on: { Ready: { target: "hidden" } } },
      waitingShown: { on: { Ready: { target: "showing" } } },
    },
  });
};

export const startMacStartup = Effect.fn("Desktop.startMacStartup")(
  function* startMacStartup(port: MacStartupPort) {
    const actor = yield* createEffectActor(macStartupMachine(), {
      input: port,
    });

    yield* watchActor("desktop.macStartup", actor);

    return {
      actor,
      open: send(actor, { type: "Open" }),
      ready: send(actor, { type: "Ready" }),
    };
  }
);
