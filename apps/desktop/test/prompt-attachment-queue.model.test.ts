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
import { attachmentMeeting } from "./prompt-attachment-fixture.js";

it.effect.prop(
  "queued attachment opens retain different index or URL identities while coalescing exact duplicates",
  {
    dimension: Arbitrary.schema(Schema.Literals(["index", "url"])),
  },
  ({ dimension }) =>
    Effect.gen(function* attachmentQueue() {
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const performed = yield* Ref.make<readonly string[]>([]);

      const first = {
        index: 0,
        key: attachmentMeeting.key,
        url: "https://files.example.test/first",
      };

      const second =
        dimension === "index"
          ? { ...first, index: 1 }
          : { ...first, url: "https://files.example.test/second" };

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

            return Predicate.isTagged(intent, "OpenPromptAttachment")
              ? Ref.update(performed, (rows) => [
                  ...rows,
                  `${intent.index}:${intent.url}`,
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

      for (const value of [first, second, first]) {
        yield* send(host.actor, {
          intent: NativeIntent.cases.OpenPromptAttachment.make(value),
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
      expect(yield* Ref.get(performed)).toEqual([
        `${second.index}:${second.url}`,
        `${first.index}:${first.url}`,
      ]);
    }).pipe(Effect.scoped)
);
