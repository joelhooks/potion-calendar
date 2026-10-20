import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Effect } from "effect";
import { types } from "xstate";

import type { DesktopError } from "./config.js";

interface BrowserAccountWork {
  readonly open: Effect.Effect<void, DesktopError>;
  readonly wait: Effect.Effect<void>;
  readonly reload: Effect.Effect<void, DesktopError>;
}

export const browserAccountMachine = (work: BrowserAccountWork) => {
  const open = createEffectLogic({ effect: work.open });
  const wait = createEffectLogic({ effect: work.wait });
  const reload = createEffectLogic({ effect: work.reload });

  return setupEffect({
    actors: { open, reload, wait },
    schemas: { context: types<{ readonly outcome: "returned" | "failed" }>() },
  }).createMachine({
    context: { outcome: "failed" },
    initial: "openingBrowser",
    output: ({ context }) => context.outcome,
    states: {
      failed: { type: "final" },
      openingBrowser: {
        invoke: {
          onDone: { target: "waitingForReturn" },
          onError: { target: "failed" },
          src: "open",
        },
      },
      reloading: {
        invoke: {
          onDone: { context: { outcome: "returned" }, target: "returned" },
          onError: { target: "failed" },
          src: "reload",
        },
      },
      returned: { type: "final" },
      waitingForReturn: {
        invoke: { onDone: { target: "reloading" }, src: "wait" },
      },
    },
  });
};

export const runBrowserAccount = Effect.fn("Desktop.browserAccount")(
  function* browserAccount(work: BrowserAccountWork) {
    const actor = yield* createEffectActor(browserAccountMachine(work));
    yield* watchActor("desktopBrowserAccount", actor);

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Work errors become a failed state; unexpected machine defects remain defects.
    return yield* join(actor).pipe(Effect.orDie);
  },
  Effect.scoped
);
