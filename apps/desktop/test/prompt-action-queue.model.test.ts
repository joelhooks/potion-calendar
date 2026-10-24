import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import {
  Arbitrary,
  Deferred,
  Effect,
  Predicate,
  Ref,
  Schema,
  Stream,
} from "effect";

import { NativeIntent, startNativeHost } from "../src/native-host.js";
import { promptIdentity } from "../src/prompt-model.js";

it.effect.prop(
  "queued card actions coalesce only the same kind and full saved key, never another card",
  {
    action: Arbitrary.schema(
      Schema.Literals(["EmailPrompt", "SnoozePrompt", "DismissPrompt"])
    ),
    dimension: Arbitrary.schema(
      Schema.Literals(["accountId", "calendarId", "eventId"])
    ),
  },
  ({ action, dimension }) =>
    Effect.gen(function* queuedCardHistory() {
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const performed = yield* Ref.make<readonly string[]>([]);

      const first = {
        accountId: "work",
        calendarId: "primary",
        eventId: "meeting",
      };

      const second = { ...first, [dimension]: "other" };

      const host = yield* startNativeHost(
        {
          intents: Stream.never,
          perform: (intent) => {
            if (Predicate.isTagged(intent, "OpenWindow")) {
              return Deferred.succeed(entered, true).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.asVoid
              );
            }

            return "key" in intent
              ? Ref.update(performed, (rows) => [
                  ...rows,
                  promptIdentity(intent.key),
                ])
              : Effect.void;
          },
          render: () => Effect.void,
        },
        { now: 0, preferences: defaultDesktopPreferences() }
      );

      yield* waitFor(
        host.actor,
        (snapshot) => snapshot.matches({ active: "idle" }),
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      yield* send(host.actor, {
        intent: NativeIntent.cases.OpenWindow.make({}),
        type: "Intent",
      });
      yield* Deferred.await(entered);

      for (const key of [first, second, first]) {
        yield* send(host.actor, {
          intent: NativeIntent.cases[action].make({ key }),
          type: "Intent",
        });
      }

      yield* send(host.actor, { now: 1, type: "Tick" });

      const pending = yield* waitFor(
        host.actor,
        (snapshot) => snapshot.context.now === 1,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);

      expect(pending.context.queued).toHaveLength(2);
      yield* Deferred.succeed(release, true);
      yield* waitFor(
        host.actor,
        (snapshot) => snapshot.matches({ active: "idle" }),
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect((yield* Ref.get(performed)).toSorted()).toEqual(
        [promptIdentity(first), promptIdentity(second)].toSorted()
      );
    }).pipe(Effect.scoped)
);
