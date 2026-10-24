import {
  PromptSoundReply,
  PromptSoundRequest,
  defaultDesktopPreferences,
  promptWire,
} from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Effect, Queue, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";

import { startPrompt } from "../src/prompt-machine.js";
import type { PromptWork } from "../src/prompt-machine.js";
import { revealWithSound } from "../src/sound-machine.js";
import { preparePromptSound } from "../src/sound-port.js";

const start = 1_792_497_600_000;

const preferences = defaultDesktopPreferences();

const meeting: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: start + 3_600_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "minute-boundary" },
  responseStatus: "accepted",
  start,
  title: "Accepted before the minute ended",
};

const soundHarness = Effect.fn("FakePromptSound.make")(
  function* soundHarness() {
    const requests = yield* Queue.unbounded<typeof PromptSoundRequest.Type>();
    const listeners = new Set<(message: string) => void>();
    const sequence = yield* Ref.make(0);
    const revealed = yield* Ref.make<number[]>([]);

    const port = {
      send: (request: typeof PromptSoundRequest.Type) => {
        Queue.offerUnsafe(requests, request);
      },
      subscribe: (receive: (message: string) => void) => {
        listeners.add(receive);

        return () => {
          listeners.delete(receive);
        };
      },
    };

    const work: PromptWork = {
      close: Effect.void,
      present: (_events, presentation) =>
        presentation.reveal
          ? Ref.updateAndGet(sequence, (previous) => previous + 1).pipe(
              Effect.flatMap((request) =>
                revealWithSound(presentation.sound, {
                  load: (tone) => preparePromptSound(port, request, tone),
                  play: (sound) =>
                    Effect.sync(() => {
                      port.send(
                        PromptSoundRequest.cases.Play.make({ request, sound })
                      );
                    }),
                  reveal: Ref.update(revealed, (ids) => [...ids, request]),
                })
              ),
              Effect.asVoid
            )
          : Effect.void,
    };

    return { listeners, requests, revealed, work };
  }
);

it.effect(
  "an accepted load crosses the end of the start minute, then reveals and plays once for the matching request",
  () =>
    Effect.gen(function* startMinuteCrossing() {
      const harness = yield* soundHarness();

      const actor = yield* startPrompt(harness.work, {
        now: start + 59_000,
        preferences,
        snapshot: { events: [meeting] },
      });

      expect(yield* Queue.take(harness.requests)).toEqual(
        PromptSoundRequest.cases.Load.make({ request: 1, sound: "blip" })
      );
      yield* TestClock.adjust(1500);
      yield* send(actor, { now: start + 60_500, type: "Tick" });
      yield* waitFor(
        actor,
        (snapshot) => snapshot.context.now === start + 60_500,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(actor.getSnapshot().context.pending).toHaveLength(1);
      expect(actor.getSnapshot().context.visible).toEqual([]);
      expect(actor.getSnapshot().context.remembered.size).toBe(0);
      expect(yield* Ref.get(harness.revealed)).toEqual([]);

      const reply = yield* Schema.encodeEffect(promptWire.soundReply)(
        PromptSoundReply.make({ phase: "load", ready: true, request: 1 })
      );

      for (const receive of harness.listeners) {
        receive(reply);
      }

      yield* TestClock.adjust(500);
      expect(yield* Ref.get(harness.revealed)).toEqual([1]);
      expect(yield* Queue.size(harness.requests)).toBe(1);
      expect(yield* Queue.take(harness.requests)).toEqual(
        PromptSoundRequest.cases.Play.make({ request: 1, sound: "blip" })
      );
      yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(actor.getSnapshot().context.visible).toHaveLength(1);
      yield* TestClock.adjust(2000);
      expect(yield* Ref.get(harness.revealed)).toEqual([1]);
      expect(yield* Queue.size(harness.requests)).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "removing the event during loading cancels the request and refuses late readiness without reveal or play",
  () =>
    Effect.gen(function* removedDuringSoundLoad() {
      const harness = yield* soundHarness();

      const actor = yield* startPrompt(harness.work, {
        now: start - 60_000,
        preferences,
        snapshot: { events: [meeting] },
      });

      expect(yield* Queue.take(harness.requests)).toEqual(
        PromptSoundRequest.cases.Load.make({ request: 1, sound: "blip" })
      );
      yield* TestClock.adjust(1000);
      yield* send(actor, { snapshot: { events: [] }, type: "Agenda" });
      yield* waitFor(actor, (snapshot) => snapshot.matches("idle"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      yield* TestClock.adjust(0);
      expect(yield* Queue.size(harness.requests)).toBe(1);
      expect(yield* Queue.take(harness.requests)).toEqual(
        PromptSoundRequest.cases.Cancel.make({ request: 1 })
      );
      expect(harness.listeners.size).toBe(0);

      const late = yield* Schema.encodeEffect(promptWire.soundReply)(
        PromptSoundReply.make({ phase: "load", ready: true, request: 1 })
      );

      for (const receive of harness.listeners) {
        receive(late);
      }

      yield* TestClock.adjust(2000);
      expect(yield* Ref.get(harness.revealed)).toEqual([]);
      expect(yield* Queue.size(harness.requests)).toBe(0);
      expect(actor.getSnapshot().context.visible).toEqual([]);
      expect(actor.getSnapshot().context.remembered.size).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "dismissing one loading card after the start minute retains the other accepted pending card",
  () =>
    Effect.gen(function* matchingDismissalDuringLoad() {
      const harness = yield* soundHarness();

      const remaining = {
        ...meeting,
        key: { ...meeting.key, eventId: "remaining" },
      };

      const actor = yield* startPrompt(harness.work, {
        now: start + 59_000,
        preferences,
        snapshot: { events: [meeting, remaining] },
      });

      expect(yield* Queue.take(harness.requests)).toEqual(
        PromptSoundRequest.cases.Load.make({ request: 1, sound: "blip" })
      );
      yield* TestClock.adjust(1500);
      yield* send(actor, { now: start + 60_500, type: "Tick" });
      yield* waitFor(
        actor,
        (snapshot) => snapshot.context.now === start + 60_500,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(actor.getSnapshot().context.pending).toHaveLength(2);
      expect(actor.getSnapshot().context.visible).toEqual([]);
      expect(actor.getSnapshot().context.remembered.size).toBe(0);
      expect(yield* Ref.get(harness.revealed)).toEqual([]);
      yield* send(actor, { key: meeting.key, type: "Dismiss" });
      yield* waitFor(
        actor,
        (snapshot) => snapshot.context.remembered.size === 1,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      yield* TestClock.adjust(0);
      expect(
        actor.getSnapshot().context.pending.map((event) => event.key.eventId)
      ).toEqual(["remaining"]);
      expect(actor.getSnapshot().context.visible).toEqual([]);
      expect(yield* Queue.size(harness.requests)).toBe(2);
      const handoff = yield* Queue.takeAll(harness.requests);

      expect(handoff).toEqual(
        expect.arrayContaining([
          PromptSoundRequest.cases.Cancel.make({ request: 1 }),
          PromptSoundRequest.cases.Load.make({ request: 2, sound: "blip" }),
        ])
      );

      const ready = yield* Schema.encodeEffect(promptWire.soundReply)(
        PromptSoundReply.make({ phase: "load", ready: true, request: 2 })
      );

      for (const receive of harness.listeners) {
        receive(ready);
      }

      yield* TestClock.adjust(500);
      expect(yield* Ref.get(harness.revealed)).toEqual([2]);
      expect(yield* Queue.size(harness.requests)).toBe(1);
      expect(yield* Queue.take(harness.requests)).toEqual(
        PromptSoundRequest.cases.Play.make({ request: 2, sound: "blip" })
      );
      yield* waitFor(actor, (snapshot) => snapshot.matches("visible"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      expect(
        actor.getSnapshot().context.visible.map((event) => event.key.eventId)
      ).toEqual(["remaining"]);
    }).pipe(Effect.scoped)
);
