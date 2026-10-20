import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Arbitrary, Deferred, Effect, Ref, Schema } from "effect";

import { DesktopError } from "../src/config.js";
import type { promptMachine } from "../src/prompt-machine.js";
import { startPrompt } from "../src/prompt-machine.js";

const minute = 60_000;

const start = 1_792_497_600_000;

const preferences = defaultDesktopPreferences();

const meeting: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: start + 60 * minute,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "meeting" },
  responseStatus: "accepted",
  start,
  title: "Saved meeting",
};

type PromptActor = EffectActor<ReturnType<typeof promptMachine>>;

type PromptSnapshot = ReturnType<PromptActor["getSnapshot"]>;

const stable = (snapshot: PromptSnapshot): boolean =>
  snapshot.matches("idle") || snapshot.matches("visible");

const settled = (
  actor: PromptActor,
  predicate: (snapshot: PromptSnapshot) => boolean = stable
) => waitFor(actor, predicate, { timeout: "2 seconds" }).pipe(Effect.orDie);

const fakePrompt = Effect.fn("FakePrompt.make")(function* fakePrompt() {
  const open = yield* Ref.make(false);
  const revealed = yield* Ref.make<readonly (readonly number[])[]>([]);
  const fail = yield* Ref.make(false);

  return {
    fail,
    open,
    revealed,
    work: {
      close: Ref.set(open, false),
      present: Effect.fn("FakePrompt.present")(function* present(
        events: readonly AgendaEventValue[]
      ) {
        if (yield* Ref.get(fail)) {
          return yield* new DesktopError({ message: "Window unavailable" });
        }

        if (!(yield* Ref.get(open))) {
          yield* Ref.update(revealed, (values) => [
            ...values,
            events.map((event) => event.start),
          ]);
        }

        return yield* Ref.set(open, true);
      }),
    },
  };
});

it.effect.prop(
  "new prompts use the configured current-minute lead window and never enter after the start minute",
  {
    delta: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: -6 }))
    ),
    lead: Arbitrary.schema(Schema.NullOr(Schema.Literals([0, 1, 2, 3, 5]))),
    withinMinute: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: minute - 1, minimum: 0 }))
    ),
  },
  ({ delta, lead, withinMinute }) =>
    Effect.gen(function* thresholdHistory() {
      const port = yield* fakePrompt();

      const actor = yield* startPrompt(port.work, {
        now: start + delta * minute + withinMinute,
        preferences: { ...preferences, promptMinutes: lead },
        snapshot: { events: [meeting] },
      });

      const snapshot = yield* settled(actor);
      const eligible = lead !== null && delta <= 0 && delta >= -lead;

      expect(snapshot.context.visible.length).toBe(eligible ? 1 : 0);
      expect(yield* Ref.get(port.open)).toBe(eligible);
    }).pipe(Effect.scoped)
);

it.effect(
  "keeps a visible prompt through fifteen whole elapsed minutes, then expires it",
  () =>
    Effect.gen(function* expiryHistory() {
      const port = yield* fakePrompt();

      const actor = yield* startPrompt(port.work, {
        now: start - minute,
        preferences,
        snapshot: { events: [meeting] },
      });

      yield* settled(actor);

      const beforeExpiry = start + 16 * minute - 1;
      yield* send(actor, { now: beforeExpiry, type: "Tick" });

      const visible = yield* settled(
        actor,
        (snapshot) => stable(snapshot) && snapshot.context.now === beforeExpiry
      );

      expect(visible.context.visible).toHaveLength(1);

      const expired = start + 16 * minute;
      yield* send(actor, { now: expired, type: "Tick" });

      const idle = yield* settled(
        actor,
        (snapshot) => stable(snapshot) && snapshot.context.now === expired
      );

      expect(idle.context.visible).toEqual([]);
      expect(yield* Ref.get(port.open)).toBe(false);
    })
);

it.effect("does not repeat a dismissed id until its saved start changes", () =>
  Effect.gen(function* dismissalHistory() {
    const port = yield* fakePrompt();

    const actor = yield* startPrompt(port.work, {
      now: start - minute,
      preferences,
      snapshot: { events: [meeting, meeting] },
    });

    const first = yield* settled(actor);
    expect(first.context.visible).toHaveLength(1);

    yield* send(actor, { eventId: meeting.key.eventId, type: "Dismiss" });
    yield* settled(
      actor,
      (snapshot) =>
        snapshot.matches("idle") && snapshot.context.visible.length === 0
    );
    yield* send(actor, { snapshot: { events: [meeting] }, type: "Agenda" });
    const sameTime = start - minute + 1;
    yield* send(actor, { now: sameTime, type: "Tick" });

    const unchanged = yield* settled(
      actor,
      (snapshot) => stable(snapshot) && snapshot.context.now === sameTime
    );

    expect(unchanged.context.visible).toEqual([]);
    expect(yield* Ref.get(port.revealed)).toHaveLength(1);

    const moved = { ...meeting, start: start + 2 * minute };
    yield* send(actor, { snapshot: { events: [moved] }, type: "Agenda" });
    const nextLead = moved.start - minute;
    yield* send(actor, { now: nextLead, type: "Tick" });

    const rescheduled = yield* settled(
      actor,
      (snapshot) => stable(snapshot) && snapshot.context.now === nextLead
    );

    expect(rescheduled.context.visible[0]?.start).toBe(moved.start);
    expect(yield* Ref.get(port.revealed)).toHaveLength(2);
  })
);

it.effect(
  "requires saved participants, conferencing, a timed non-declined event and an enabled menu bar",
  () =>
    Effect.gen(function* eligibilityHistory() {
      const port = yield* fakePrompt();

      const actor = yield* startPrompt(port.work, {
        now: start - minute,
        preferences,
        snapshot: {
          events: [
            { ...meeting, hasParticipants: false },
            {
              ...meeting,
              conferenceUrl: null,
              key: { ...meeting.key, eventId: "no-link" },
            },
            {
              ...meeting,
              allDay: true,
              key: { ...meeting.key, eventId: "all-day" },
            },
            {
              ...meeting,
              key: { ...meeting.key, eventId: "declined" },
              responseStatus: "declined",
            },
          ],
        },
      });

      const initial = yield* settled(actor);
      expect(initial.context.visible).toEqual([]);

      yield* send(actor, { snapshot: { events: [meeting] }, type: "Agenda" });
      yield* settled(actor, (snapshot) => snapshot.matches("visible"));
      yield* send(actor, {
        preferences: { ...preferences, menuBar: false },
        type: "Settings",
      });

      const disabled = yield* settled(
        actor,
        (snapshot) => stable(snapshot) && !snapshot.context.preferences.menuBar
      );

      expect(disabled.context.visible).toEqual([]);
      expect(yield* Ref.get(port.open)).toBe(false);
    })
);

it.effect("a failed presentation is not remembered as shown", () =>
  Effect.gen(function* failedPresentation() {
    const port = yield* fakePrompt();
    yield* Ref.set(port.fail, true);

    const actor = yield* startPrompt(port.work, {
      now: start - minute,
      preferences,
      snapshot: { events: [meeting] },
    });

    const failed = yield* settled(actor);
    expect(failed.context.remembered.has(meeting.key.eventId)).toBe(false);
    expect(failed.context.visible).toEqual([]);

    yield* Ref.set(port.fail, false);
    yield* send(actor, { now: start, type: "Tick" });

    const retried = yield* settled(
      actor,
      (snapshot) => stable(snapshot) && snapshot.context.now === start
    );

    expect(retried.context.visible).toHaveLength(1);
  })
);

it.effect(
  "disabling the feature interrupts a pending presentation before it can claim visible cards",
  () =>
    Effect.gen(function* cancelledPresentation() {
      const entered = yield* Deferred.make<boolean>();
      const cancelled = yield* Deferred.make<boolean>();

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: () =>
            Effect.acquireRelease(Deferred.succeed(entered, true), () =>
              Deferred.succeed(cancelled, true)
            ).pipe(
              Effect.flatMap(() => Effect.never),
              Effect.scoped
            ),
        },
        { now: start - minute, preferences, snapshot: { events: [meeting] } }
      );

      yield* Deferred.await(entered);
      yield* send(actor, {
        preferences: { ...preferences, menuBar: false },
        type: "Settings",
      });
      yield* Deferred.await(cancelled);

      const snapshot = yield* settled(
        actor,
        (value) => stable(value) && !value.context.preferences.menuBar
      );

      expect(snapshot.context.visible).toEqual([]);
      expect(snapshot.context.remembered.has(meeting.key.eventId)).toBe(false);
    })
);
