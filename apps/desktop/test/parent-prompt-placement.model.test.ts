import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type { AgendaSnapshotValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Arbitrary, Deferred, Effect, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { startPrompt } from "../src/prompt-machine.js";
import type { PromptPresentation } from "../src/prompt-machine.js";
import {
  promptMeeting,
  promptNow,
  promptPreferences,
} from "./prompt-preferences-fixture.js";

const snapshot = (
  revision: number,
  display: "cursor" | "primary",
  lease = "current-parent"
): AgendaSnapshotValue => ({
  events: [promptMeeting],
  notificationAgenda: {
    deliveries: [],
    events: [],
    lease,
    personId: "current-person",
    revision,
    version: 1,
  },
  promptPreferences: {
    ...promptPreferences,
    placement: { anchor: "topCenter", display },
  },
});

it.effect.prop(
  "only current admitted parent authority may change a visible placement through ordinary publications",
  {
    revision: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: 2 }))
    ),
  },
  ({ revision }) =>
    Effect.gen(function* scopedPlacementHistory() {
      yield* TestClock.setTime(promptNow);
      const published = yield* Ref.make<PromptPresentation[]>([]);

      const preferences = {
        ...defaultDesktopPreferences(),
        promptSound: "none",
      } as const;

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: (_events, value) =>
            Ref.update(published, (values) => [...values, value]),
        },
        { now: promptNow, preferences, snapshot: snapshot(revision, "primary") }
      );

      yield* waitFor(actor, (s) => s.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      const original = yield* Ref.get(published);

      for (const stale of [
        snapshot(revision - 1, "cursor"),
        snapshot(revision + 1, "cursor", "foreign-parent"),
      ]) {
        yield* send(actor, {
          now: promptNow,
          preferences,
          snapshot: stale,
          type: "Input",
        });
        yield* waitFor(
          actor,
          (s) =>
            s.matches("visible") &&
            s.context.snapshot.notificationAgenda?.lease ===
              stale.notificationAgenda?.lease &&
            s.context.snapshot.notificationAgenda?.revision ===
              stale.notificationAgenda?.revision,
          { timeout: "1 second" }
        ).pipe(Effect.orDie);
        yield* send(actor, { snapshot: stale, type: "Agenda" });
        yield* send(actor, {
          attempt: "foreign",
          now: promptNow,
          permit: {
            active: true,
            main: {
              lease: "current-parent",
              personId: "current-person",
              revision,
            },
          },
          preferences,
          snapshot: stale,
          type: "AdmissionInput",
        });
        expect(
          (yield* Ref.get(published)).at(-1)?.preferences?.placement
        ).toEqual(original.at(-1)?.preferences?.placement);
        expect(actor.getSnapshot().context.placementAuthority).toEqual({
          lease: "current-parent",
          personId: "current-person",
          revision,
        });
      }

      yield* send(actor, {
        attempt: "valid-new-owner",
        now: promptNow,
        permit: {
          active: true,
          main: {
            lease: "new-parent",
            personId: "current-person",
            revision: revision + 1,
          },
        },
        preferences,
        snapshot: snapshot(revision + 1, "cursor", "new-parent"),
        type: "AdmissionInput",
      });
      yield* waitFor(
        actor,
        (s) =>
          s.matches("visible") &&
          s.context.snapshot.notificationAgenda?.lease === "new-parent",
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect((yield* Ref.get(published)).at(-1)?.authority).toEqual({
        lease: "new-parent",
        personId: "current-person",
        revision: revision + 1,
      });
      expect((yield* Ref.get(published)).filter((p) => p.reveal)).toHaveLength(
        1
      );
    }).pipe(Effect.scoped)
);

it.effect(
  "a pending presentation is cancelled on a newer placement and only the latest admitted revision completes",
  () =>
    Effect.gen(function* pendingPlacementHistory() {
      yield* TestClock.setTime(promptNow);
      const entered = yield* Deferred.make<boolean>();
      const held = yield* Deferred.make<boolean>();
      const interrupted = yield* Ref.make(0);
      const completed = yield* Ref.make<PromptPresentation[]>([]);

      const preferences = {
        ...defaultDesktopPreferences(),
        promptSound: "none",
      } as const;

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: (_events, value) =>
            Effect.gen(function* delayedNativePresentation() {
              if (value.authority?.revision === 1) {
                yield* Deferred.succeed(entered, true);
                yield* Deferred.await(held).pipe(
                  Effect.onInterrupt(() =>
                    Ref.update(interrupted, (n) => n + 1)
                  )
                );
              }

              yield* Ref.update(completed, (values) => [...values, value]);
            }),
        },
        { now: promptNow, preferences, snapshot: snapshot(1, "cursor") }
      );

      yield* Deferred.await(entered);
      yield* send(actor, {
        now: promptNow,
        preferences,
        snapshot: snapshot(2, "primary"),
        type: "Input",
      });
      yield* waitFor(
        actor,
        (s) =>
          s.matches("visible") &&
          s.context.snapshot.notificationAgenda?.revision === 2,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      yield* Deferred.succeed(held, true);
      expect(yield* Ref.get(interrupted)).toBe(1);
      expect(
        (yield* Ref.get(completed)).map((p) => p.authority?.revision)
      ).toEqual([2]);
      expect(
        (yield* Ref.get(completed)).at(-1)?.preferences?.placement
      ).toEqual({ anchor: "topCenter", display: "primary" });
    }).pipe(Effect.scoped)
);
