import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Context, Effect, Layer, Predicate, Schema } from "effect";
import { types } from "xstate";

import { CalendarChanges } from "./changes.js";
import { Gone, Provider } from "./errors.js";
import type { CalendarFailureValue } from "./errors.js";
import { GoogleCalendarClient } from "./google.js";
import { CalendarRef } from "./model.js";
import type { CalendarRefValue } from "./model.js";
import { CalendarStore } from "./store.js";
import { SyncExpired } from "./sync-expired.js";
import type { SyncResultValue } from "./sync-result.js";

export const CalendarReadBudget = Context.Reference<{
  readonly maxPages: number;
}>("@calendar/calendar/CalendarReadBudget", {
  defaultValue: () => ({ maxPages: 1000 }),
});

export class CalendarSync extends Context.Service<
  CalendarSync,
  {
    readonly pull: (
      ref: CalendarRefValue
    ) => Effect.Effect<SyncResultValue, CalendarFailureValue | SyncExpired>;
    readonly reset: (
      ref: CalendarRefValue,
      expectedVersion: number
    ) => Effect.Effect<void, CalendarFailureValue>;
  }
>()("@calendar/calendar/CalendarSync") {
  static readonly layer = Layer.effect(
    CalendarSync,
    Effect.gen(function* layer() {
      const google = yield* GoogleCalendarClient;
      const store = yield* CalendarStore;
      const budget = yield* CalendarReadBudget;
      const changes = yield* CalendarChanges;

      return CalendarSync.of({
        pull: Effect.fn("CalendarSync.pull")(function* pull(ref) {
          const snapshot = yield* store.read(ref);
          let changed = 0;
          const seen = new Set<string>();
          let pageToken: string | undefined;

          for (
            let pageNumber = 0;
            pageNumber < budget.maxPages;
            pageNumber += 1
          ) {
            const page = yield* google
              .listPage({
                pageToken,
                ref,
                singleEvents: false,
                syncToken: snapshot.cursor,
              })
              .pipe(
                Effect.catchTag("Gone", () =>
                  Effect.fail(new SyncExpired({ version: snapshot.revision }))
                )
              );

            changed += page.events.length;

            if (page.nextPageToken === undefined) {
              if (page.nextSyncToken === undefined) {
                return yield* new Provider({
                  message:
                    "Final sync page omitted its cursor; cache left unchanged",
                  operation: "sync",
                  status: 200,
                });
              }

              const committed = yield* store.commit(
                ref,
                snapshot.revision,
                changed,
                page.nextSyncToken
              );

              if (!committed) {
                return yield* new Provider({
                  message:
                    "Another sync changed this calendar; retry from the new cursor",
                  operation: "sync",
                  status: 409,
                });
              }

              const version = snapshot.version + (changed > 0 ? 1 : 0);

              if (changed > 0) {
                yield* changes.publish({ ...ref, reason: "sync", version });
              }

              return {
                changed,
                cursor: page.nextSyncToken,
                version,
              };
            }

            if (seen.has(page.nextPageToken)) {
              return yield* new Provider({
                message: "Google repeated a page token; cache left unchanged",
                operation: "sync",
                status: 200,
              });
            }

            seen.add(page.nextPageToken);
            pageToken = page.nextPageToken;
          }

          return yield* new Provider({
            message: "Sync exceeded its page budget; cache left unchanged",
            operation: "sync",
            status: 0,
          });
        }),
        reset: Effect.fn("CalendarSync.reset")(
          function* reset(ref, expectedVersion) {
            const cleared = yield* store.clear(ref, expectedVersion);

            if (!cleared) {
              return yield* new Provider({
                message: "Another sync changed this calendar; retry",
                operation: "sync.reset",
                status: 409,
              });
            }

            const snapshot = yield* store.read(ref);

            return yield* changes.publish({
              ...ref,
              reason: "reset",
              version: snapshot.version,
            });
          }
        ),
      });
    })
  );
}

type SyncOutcome =
  | { readonly result: SyncResultValue }
  | { readonly error: CalendarFailureValue };

interface SyncContext {
  readonly ref: CalendarRefValue;
  readonly reset: boolean;
  readonly version: number;
  readonly outcome: SyncOutcome | undefined;
}

const pullCalendar = createEffectLogic({
  effect: ({ input }) => CalendarSync.use((sync) => sync.pull(input)),
  schemas: { input: CalendarRef },
});

const resetCalendar = createEffectLogic({
  effect: ({ input }) =>
    CalendarSync.use((sync) => sync.reset(input.ref, input.version)),
  schemas: { input: Schema.Struct({ ref: CalendarRef, version: Schema.Int }) },
});

export const syncMachine = setupEffect({
  actors: { pullCalendar, resetCalendar },
  schemas: { context: types<SyncContext>(), input: CalendarRef },
}).createMachine({
  context: ({ input }) => ({
    outcome: undefined,
    ref: input,
    reset: false,
    version: 0,
  }),
  initial: "syncing",
  output: ({ context }) => context.outcome,
  states: {
    failed: { type: "final" },
    "full-resync": {
      invoke: {
        input: ({ context }) => ({
          ref: context.ref,
          version: context.version,
        }),
        onDone: { target: "syncing" },
        onError: {
          context: ({ event }) => ({ outcome: { error: event.error } }),
          target: "failed",
        },
        src: "resetCalendar",
      },
    },
    idle: { type: "final" },
    syncing: {
      invoke: {
        input: ({ context }) => context.ref,
        onDone: {
          context: ({ event }) => ({ outcome: { result: event.output } }),
          target: "idle",
        },
        onError: ({ context, event }) => {
          if (Predicate.isTagged(event.error, "SyncExpired")) {
            return context.reset
              ? {
                  context: {
                    outcome: { error: new Gone({ operation: "sync" }) },
                  },
                  target: "failed",
                }
              : {
                  context: { reset: true, version: event.error.version },
                  target: "full-resync",
                };
          }

          return {
            context: { outcome: { error: event.error } },
            target: "failed",
          };
        },
        src: "pullCalendar",
      },
    },
  },
});

export const syncCalendar = Effect.fn("syncCalendar")(function* syncCalendar(
  ref: CalendarRefValue
) {
  const actor = yield* createEffectActor(syncMachine, { input: ref });
  yield* watchActor("calendarSync", actor);
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Expected provider failures travel in the outcome; machine crashes remain defects.
  const outcome = yield* join(actor).pipe(Effect.orDie);

  if (outcome === undefined) {
    return yield* Effect.die(
      new Error("Calendar sync finished without an outcome")
    );
  }

  if ("error" in outcome) {
    return yield* outcome.error;
  }

  return outcome.result;
}, Effect.scoped);
