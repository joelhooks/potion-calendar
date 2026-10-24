import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Arbitrary, Deferred, Effect, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { startPrompt } from "../src/prompt-machine.js";
import type { PromptPresentation } from "../src/prompt-machine.js";
import { promptBatchIdentity } from "../src/prompt-model.js";
import { revealWithSound } from "../src/sound-machine.js";

const now = 1_792_497_540_000;

const preferences = defaultDesktopPreferences();

const meeting: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: now + 3_600_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "one" },
  responseStatus: "accepted",
  start: now + 60_000,
  title: "Meeting",
};

it.effect.prop(
  "addition identity ignores order and presentation content but owns every event key and start",
  {
    offset: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1000, minimum: 1 }))
    ),
    title: Arbitrary.schema(Schema.String),
  },
  ({ offset, title }) =>
    Effect.sync(() => {
      const second = {
        ...meeting,
        key: { ...meeting.key, eventId: "other" },
        start: meeting.start + offset,
      };

      const original = promptBatchIdentity([meeting, second]);

      expect(
        promptBatchIdentity([
          { ...second, title },
          { ...meeting, title: "Updated presentation" },
        ])
      ).toBe(original);
      expect(promptBatchIdentity([meeting])).not.toBe(original);
      expect(
        promptBatchIdentity([meeting, { ...second, start: second.start + 1 }])
      ).not.toBe(original);
      expect(
        promptBatchIdentity([
          meeting,
          { ...second, key: { ...second.key, accountId: "other-account" } },
        ])
      ).not.toBe(original);
    })
);

it.effect(
  "same addition identities preserve the two-second deadline through content and ordering updates",
  () =>
    Effect.gen(function* identicalBatch() {
      const entered = yield* Deferred.make<boolean>();
      const loads = yield* Ref.make(0);
      const reveals = yield* Ref.make(0);
      const played = yield* Ref.make(0);
      const shown = yield* Ref.make<readonly AgendaEventValue[]>([]);
      const second = { ...meeting, key: { ...meeting.key, eventId: "two" } };

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: (
            events: readonly AgendaEventValue[],
            presentation: PromptPresentation
          ) =>
            Ref.set(shown, events).pipe(
              Effect.andThen(
                presentation.reveal
                  ? revealWithSound(presentation.sound, {
                      load: () =>
                        Ref.updateAndGet(loads, (count) => count + 1).pipe(
                          Effect.flatMap((attempt) =>
                            attempt === 1
                              ? Deferred.succeed(entered, true).pipe(
                                  Effect.andThen(Effect.never)
                                )
                              : Effect.void
                          )
                        ),
                      play: () => Ref.update(played, (count) => count + 1),
                      reveal: Ref.update(reveals, (count) => count + 1),
                    })
                  : Effect.void
              ),
              Effect.asVoid
            ),
        },
        { now, preferences, snapshot: { events: [meeting, second] } }
      );

      yield* Deferred.await(entered);
      yield* TestClock.adjust(1000);
      yield* send(actor, {
        now: now + 1000,
        preferences,
        snapshot: {
          events: [second, { ...meeting, title: "Updated during load" }],
        },
        type: "Input",
      });
      yield* send(actor, { preferences, type: "Settings" });
      yield* send(actor, { now: now + 1500, type: "Tick" });
      yield* TestClock.adjust(999);
      expect(yield* Ref.get(reveals)).toBe(0);
      expect(yield* Ref.get(loads)).toBe(1);
      yield* TestClock.adjust(1);
      yield* Effect.yieldNow;
      expect(yield* Ref.get(reveals)).toBe(1);
      yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(yield* Ref.get(loads)).toBe(1);
      expect(yield* Ref.get(played)).toBe(0);
      expect(
        (yield* Ref.get(shown)).map((event) => [event.key.eventId, event.title])
      ).toEqual([
        ["one", "Updated during load"],
        ["two", "Meeting"],
      ]);
    }).pipe(Effect.scoped)
);

it.effect(
  "new additions play once per batch; updates, removals and preference sync do not replay",
  () =>
    Effect.gen(function* additionBatches() {
      const attempts = yield* Ref.make<string[]>([]);

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: (
            _events: readonly AgendaEventValue[],
            presentation: PromptPresentation
          ) =>
            presentation.reveal
              ? Ref.update(attempts, (sounds) => [
                  ...sounds,
                  presentation.sound,
                ])
              : Effect.void,
        },
        { now, preferences, snapshot: { events: [meeting] } }
      );

      yield* waitFor(actor, (s) => s.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      const second = { ...meeting, key: { ...meeting.key, eventId: "two" } };
      const third = { ...meeting, key: { ...meeting.key, eventId: "three" } };
      yield* send(actor, {
        snapshot: { events: [meeting, second, third] },
        type: "Agenda",
      });
      yield* waitFor(
        actor,
        (s) => s.matches("visible") && s.context.visible.length === 3,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(yield* Ref.get(attempts)).toEqual(["blip", "blip"]);
      yield* send(actor, {
        preferences: { ...preferences, promptSound: "bell" },
        type: "Settings",
      });
      yield* send(actor, {
        snapshot: { events: [{ ...meeting, title: "Updated" }, second] },
        type: "Agenda",
      });
      yield* waitFor(
        actor,
        (s) => s.matches("visible") && s.context.visible.length === 2,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(yield* Ref.get(attempts)).toEqual(["blip", "blip"]);
      yield* send(actor, { type: "Closed" });
      yield* send(actor, {
        snapshot: { events: [meeting, second] },
        type: "Agenda",
      });
      yield* waitFor(actor, (s) => s.matches("idle"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(yield* Ref.get(attempts)).toEqual(["blip", "blip"]);
    }).pipe(Effect.scoped)
);
