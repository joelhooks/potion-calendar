import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  PromptSound,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Arbitrary, Deferred, Effect, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { requestPromptSnooze } from "../src/prompt-actions.js";
import { startPrompt } from "../src/prompt-machine.js";
import { revealWithSound } from "../src/sound-machine.js";
import { settledPromptAt } from "./prompt-observation.js";

const first: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: 3_600_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "first" },
  responseStatus: "accepted",
  start: 120_000,
  title: "First meeting",
};

const second = { ...first, key: { ...first.key, eventId: "second" } };

const harness = Effect.fn("FakeSnoozeSound.make")(function* harness(
  events: readonly AgendaEventValue[] = [first],
  sound: typeof PromptSound.Type = "blip",
  blockedLoads: readonly number[] = []
) {
  yield* TestClock.setTime(120_000);
  const entered = yield* Deferred.make<boolean>();
  const release = yield* Deferred.make<boolean>();
  const cancelled = yield* Ref.make(0);
  const loads = yield* Ref.make(0);
  const plays = yield* Ref.make<readonly string[]>([]);
  const reveals = yield* Ref.make<readonly (readonly string[])[]>([]);

  const actor = yield* startPrompt(
    {
      close: Effect.void,
      present: (cards, presentation) =>
        presentation.reveal
          ? revealWithSound(presentation.sound, {
              load: () =>
                Ref.updateAndGet(loads, (count) => count + 1).pipe(
                  Effect.flatMap((count) =>
                    blockedLoads.includes(count)
                      ? Effect.acquireRelease(
                          Deferred.succeed(entered, true),
                          () => Ref.update(cancelled, (value) => value + 1)
                        ).pipe(
                          Effect.andThen(Deferred.await(release)),
                          Effect.asVoid,
                          Effect.scoped
                        )
                      : Effect.void
                  )
                ),
              play: (tone) => Ref.update(plays, (tones) => [...tones, tone]),
              reveal: Ref.update(reveals, (rows) => [
                ...rows,
                cards.map((card) => card.key.eventId).toSorted(),
              ]),
            }).pipe(Effect.asVoid)
          : Effect.void,
    },
    {
      now: 120_000,
      preferences: { ...defaultDesktopPreferences(), promptSound: sound },
      snapshot: { events },
    }
  );

  if (!blockedLoads.includes(1)) {
    yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
      timeout: "1 second",
    }).pipe(Effect.orDie);
  }

  return { actor, cancelled, entered, loads, plays, release, reveals };
});

it.effect.prop(
  "independent snoozes preserve their original deadlines and each returning addition plays once",
  {
    offset: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 59_000, minimum: 1 }))
    ),
  },
  ({ offset }) =>
    Effect.gen(function* staggeredSnoozes() {
      const { actor, plays, reveals } = yield* harness([first, second]);
      yield* requestPromptSnooze(actor, first.key);
      yield* TestClock.adjust(offset);
      yield* requestPromptSnooze(actor, second.key);
      yield* TestClock.adjust(60_000 - offset);
      const observed = [{ ...first, title: "Observed first deadline" }, second];
      yield* send(actor, { snapshot: { events: observed }, type: "Agenda" });
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.context.snapshot.events[0]?.title ===
          "Observed first deadline",
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(
        actor.getSnapshot().context.pending.map((card) => card.key.eventId)
      ).toEqual(["first"]);
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("visible") && snapshot.context.visible.length === 1,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(
        actor.getSnapshot().context.visible.map((card) => card.key.eventId)
      ).toEqual(["first"]);
      expect(yield* Ref.get(plays)).toHaveLength(2);
      yield* TestClock.adjust(offset);
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("visible") && snapshot.context.visible.length === 2,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(yield* Ref.get(reveals)).toEqual([
        ["first", "second"],
        ["first"],
        ["first", "second"],
      ]);
      expect(yield* Ref.get(plays)).toHaveLength(3);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "same-deadline returns form one fresh batch and No sound bypasses load and play",
  {
    sound: Arbitrary.schema(Schema.Literals(["none", "blip", "bell", "tap"])),
  },
  ({ sound }) =>
    Effect.gen(function* coalescedSnoozes() {
      const { actor, loads, plays, reveals } = yield* harness(
        [first, second],
        sound
      );

      yield* requestPromptSnooze(actor, first.key);
      yield* requestPromptSnooze(actor, second.key);
      yield* TestClock.adjust(60_000);
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("visible") && snapshot.context.visible.length === 2,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(yield* Ref.get(reveals)).toEqual([
        ["first", "second"],
        ["first", "second"],
      ]);
      expect(yield* Ref.get(loads)).toBe(sound === "none" ? 0 : 2);
      expect(yield* Ref.get(plays)).toHaveLength(sound === "none" ? 0 : 2);
    }).pipe(Effect.scoped)
);

it.effect(
  "snoozing during sound preparation cancels it, fences late readiness and returns as one fresh play",
  () =>
    Effect.gen(function* snoozeWhileLoading() {
      const { actor, cancelled, entered, plays, release, reveals } =
        yield* harness([first], "blip", [1]);

      yield* Deferred.await(entered);
      yield* requestPromptSnooze(actor, first.key);
      yield* TestClock.adjust(2000);
      expect(yield* Ref.get(cancelled)).toBe(1);
      expect(yield* Ref.get(reveals)).toEqual([]);
      yield* Deferred.succeed(release, true);
      yield* TestClock.adjust(58_000);
      yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(yield* Ref.get(reveals)).toEqual([["first"]]);
      expect(yield* Ref.get(plays)).toEqual(["blip"]);
    }).pipe(Effect.scoped)
);

it.effect(
  "an obsolete snooze tick cannot cancel or extend the current two-second sound deadline",
  () =>
    Effect.gen(function* obsoleteDeadline() {
      const { actor, cancelled, entered, loads, plays, reveals } =
        yield* harness([first], "blip", [2, 3, 4]);

      yield* requestPromptSnooze(actor, first.key);
      yield* TestClock.adjust(59_000);
      const addition = { ...second, start: 180_000 };
      yield* send(actor, {
        snapshot: { events: [first, addition] },
        type: "Agenda",
      });
      yield* Deferred.await(entered);
      const moved = { ...first, start: 180_000, title: "Moved saved meeting" };
      yield* send(actor, {
        snapshot: { events: [moved, addition] },
        type: "Agenda",
      });
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.matches("presenting") &&
          snapshot.context.pending.length === 2,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(yield* Ref.get(loads)).toBe(3);
      expect(yield* Ref.get(cancelled)).toBe(1);
      yield* TestClock.adjust(1000);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.now).toBe(180_000);
      expect(yield* Ref.get(loads)).toBe(3);
      expect(yield* Ref.get(cancelled)).toBe(1);
      expect(yield* Ref.get(reveals)).toHaveLength(1);
      yield* TestClock.adjust(1000);
      yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(
        actor
          .getSnapshot()
          .context.visible.map((card) => card.key.eventId)
          .toSorted()
      ).toEqual(["first", "second"]);
      expect(yield* Ref.get(reveals)).toEqual([["first"], ["first", "second"]]);
      expect(yield* Ref.get(plays)).toEqual(["blip"]);
    }).pipe(Effect.scoped)
);

it.effect.each([
  "no-notification",
  "no-conference",
  "no-participants",
  "all-day",
])("the deadline rechecks %s before returning", (change) =>
  Effect.gen(function* ineligibleDeadline() {
    const { actor, plays, reveals } = yield* harness();
    yield* requestPromptSnooze(actor, first.key);

    if (change === "no-notification") {
      yield* send(actor, {
        preferences: { ...defaultDesktopPreferences(), promptMinutes: null },
        type: "Settings",
      });
    } else {
      const updated = {
        ...first,
        allDay: change === "all-day",
        conferenceUrl: change === "no-conference" ? null : first.conferenceUrl,
        hasParticipants: change !== "no-participants",
      };

      yield* send(actor, { snapshot: { events: [updated] }, type: "Agenda" });
    }

    yield* TestClock.adjust(60_000);
    yield* settledPromptAt(actor, 180_000);
    expect(actor.getSnapshot().context.visible).toEqual([]);
    expect(yield* Ref.get(reveals)).toHaveLength(1);
    expect(yield* Ref.get(plays)).toHaveLength(1);
  }).pipe(Effect.scoped)
);

it.effect(
  "a duplicate hidden-card snooze cannot postpone its first deadline",
  () =>
    Effect.gen(function* duplicateSnooze() {
      const { actor, reveals } = yield* harness();
      yield* requestPromptSnooze(actor, first.key);
      yield* TestClock.adjust(30_000);
      yield* requestPromptSnooze(actor, first.key);
      yield* TestClock.adjust(30_000);
      yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(yield* Ref.get(reveals)).toHaveLength(2);
    }).pipe(Effect.scoped)
);

it.effect(
  "a snooze crossing the fifteen-whole-minute expiry does not return",
  () =>
    Effect.gen(function* expiredSnooze() {
      const { actor, reveals } = yield* harness();
      yield* TestClock.adjust(15 * 60_000 + 30_000);
      yield* requestPromptSnooze(actor, first.key);
      yield* TestClock.adjust(60_000);
      yield* settledPromptAt(actor, 1_110_000);
      expect(actor.getSnapshot().context.visible).toEqual([]);
      expect(yield* Ref.get(reveals)).toHaveLength(1);
    }).pipe(Effect.scoped)
);
