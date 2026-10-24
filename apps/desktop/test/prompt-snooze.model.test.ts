import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Arbitrary, Effect, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { startPrompt } from "../src/prompt-machine.js";
import { promptIdentity } from "../src/prompt-model.js";
import { settledPromptAt } from "./prompt-observation.js";

const meeting: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: 3_600_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "snoozed" },
  responseStatus: "accepted",
  start: 120_000,
  title: "Saved meeting",
};

const makeHarness = Effect.fn("FakeSnooze.make")(function* makeHarness(
  now: number,
  events: readonly AgendaEventValue[] = [meeting]
) {
  yield* TestClock.setTime(now);
  const presentations = yield* Ref.make<readonly string[][]>([]);
  const sounds = yield* Ref.make<readonly string[]>([]);

  const actor = yield* startPrompt(
    {
      close: Effect.void,
      present: (cards, presentation) =>
        presentation.reveal
          ? Ref.update(presentations, (rows) => [
              ...rows,
              cards.map((card) => card.key.eventId),
            ]).pipe(
              Effect.andThen(
                Ref.update(sounds, (rows) => [...rows, presentation.sound])
              )
            )
          : Effect.void,
    },
    {
      now,
      preferences: defaultDesktopPreferences(),
      snapshot: { events },
    }
  );

  yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
    timeout: "1 second",
  }).pipe(Effect.orDie);

  return { actor, presentations, sounds };
});

it.effect.prop(
  "snooze hides without a cleared mark and returns exactly at 60 seconds even across the start minute",
  {
    offset: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 59_999, minimum: 0 }))
    ),
  },
  ({ offset }) =>
    Effect.gen(function* snoozeHistory() {
      const now = 120_000 + offset;
      const { actor, presentations, sounds } = yield* makeHarness(now);
      yield* send(actor, { key: meeting.key, now, type: "Snooze" });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.pending).toEqual([]);
      expect(actor.getSnapshot().context.visible).toEqual([]);
      expect(
        actor.getSnapshot().context.remembered.has(promptIdentity(meeting.key))
      ).toBe(false);
      expect(
        actor.getSnapshot().context.snoozed.get(promptIdentity(meeting.key))
      ).toEqual({ start: meeting.start, until: now + 60_000 });
      yield* TestClock.adjust(59_999);

      const before = {
        ...meeting,
        title: "Observed before the exact deadline",
      };

      yield* send(actor, { snapshot: { events: [before] }, type: "Agenda" });
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.context.snapshot.events[0]?.title === before.title,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(actor.getSnapshot().context.visible).toEqual([]);
      expect(yield* Ref.get(presentations)).toHaveLength(1);
      yield* TestClock.adjust(1);

      const observed = {
        ...meeting,
        title: "Observed after the exact deadline",
      };

      yield* send(actor, { snapshot: { events: [observed] }, type: "Agenda" });
      yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.context.snapshot.events[0]?.title === observed.title,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(actor.getSnapshot().context.pending).toHaveLength(1);
      yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(yield* Ref.get(presentations)).toEqual([["snoozed"], ["snoozed"]]);
      expect(yield* Ref.get(sounds)).toEqual(["blip", "blip"]);
      yield* TestClock.adjust(120_000);
      expect(yield* Ref.get(presentations)).toHaveLength(2);
    }).pipe(Effect.scoped)
);

it.effect.each(["removed", "declined", "disabled", "expired"])(
  "a snoozed %s card does not return",
  (change) =>
    Effect.gen(function* cancelledSnooze() {
      const { actor, presentations } = yield* makeHarness(120_000);
      yield* send(actor, { key: meeting.key, now: 120_000, type: "Snooze" });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.visible).toEqual([]);

      if (change === "disabled") {
        yield* send(actor, {
          preferences: { ...defaultDesktopPreferences(), menuBar: false },
          type: "Settings",
        });
      } else if (change === "expired") {
        yield* send(actor, {
          snapshot: { events: [{ ...meeting, start: -900_000 }] },
          type: "Agenda",
        });
      } else {
        yield* send(actor, {
          snapshot: {
            events:
              change === "removed"
                ? []
                : [{ ...meeting, responseStatus: "declined" }],
          },
          type: "Agenda",
        });
      }

      yield* TestClock.adjust(60_000);

      if (change !== "expired") {
        yield* settledPromptAt(actor, 180_000);
      }

      expect(actor.getSnapshot().context.visible).toEqual([]);
      expect(yield* Ref.get(presentations)).toHaveLength(1);
    }).pipe(Effect.scoped)
);

it.effect(
  "a saved time change cancels the snooze and follows ordinary new-event eligibility",
  () =>
    Effect.gen(function* movedSnooze() {
      const { actor, presentations } = yield* makeHarness(120_000);
      yield* send(actor, { key: meeting.key, now: 120_000, type: "Snooze" });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      expect(actor.getSnapshot().context.visible).toEqual([]);
      const moved = { ...meeting, start: 180_000 };
      yield* send(actor, {
        snapshot: { events: [moved, moved] },
        type: "Agenda",
      });

      const changed = yield* waitFor(
        actor,
        (snapshot) =>
          snapshot.context.snapshot.events[0]?.start === moved.start,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);

      expect(changed.context.pending).toEqual([moved]);
      yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(actor.getSnapshot().context.visible).toEqual([moved]);
      yield* TestClock.adjust(60_000);
      expect(yield* Ref.get(presentations)).toHaveLength(2);
    }).pipe(Effect.scoped)
);
