import { Provider } from "@calendar/calendar/contracts";
import type { RsvpInput } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send, snapshots } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Effect, Option, Queue, Schema, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { RsvpResult, rsvpMachine } from "../src/client/editing/rsvp-machine.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { editorOriginal } from "./editor-fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

type Actor = EffectActor<typeof rsvpMachine>;

const step = Effect.fn("rsvpStep")(function* rsvpStep(
  actor: Actor,
  event: Parameters<Actor["send"]>[0]
) {
  const queue = yield* Queue.unbounded<ReturnType<Actor["getSnapshot"]>>();

  return yield* Effect.acquireUseRelease(
    Effect.sync(() =>
      actor.subscribe((snapshot) => {
        Queue.offerUnsafe(queue, snapshot);
      })
    ),
    () => send(actor, event).pipe(Effect.andThen(Queue.take(queue))),
    (subscription) =>
      Effect.sync(() => {
        subscription.unsubscribe();
      })
  );
});

const harness = Effect.fn("rsvpHarness")(function* rsvpHarness(
  refuse?: boolean
) {
  const calls: (typeof RsvpInput.Type)[] = [];

  const failure = new Provider({
    message: "Fixture RSVP refused",
    operation: "rsvp",
    status: 403,
  });

  const client = CalendarEditingClient.of({
    createEvent: () => Effect.succeed(editorOriginal),
    deleteEvent: () => Effect.void,
    getEvent: () => Effect.succeed(editorOriginal),
    moveAndRetimeSeries: () => Effect.die("Unexpected series operation"),
    moveEvent: () => Effect.succeed(editorOriginal),
    moveSupport: "notAvailable",
    rsvp: (input) =>
      Effect.gen(function* respond() {
        calls.push(input);

        return yield* refuse === true
          ? Effect.fail(failure)
          : Effect.succeed(editorOriginal);
      }),
    updateEvent: () => Effect.succeed(editorOriginal),
  });

  const actor = yield* createEffectActor(rsvpMachine).pipe(
    Effect.provideService(CalendarEditingClient, client)
  );

  yield* watchActor("calendar.rsvp.test", actor);

  return { actor, calls, failure };
});

it.effect.each([
  { key: "y", response: "accepted" },
  { key: "n", response: "declined" },
  { key: "m", response: "tentative" },
])(
  "E then $key responds $response without email and keeps the optional note",
  ({ key, response }) =>
    Effect.gen(function* shortcutResponse() {
      const h = yield* harness();
      const base = keyboardFixture();

      const prefix = update(
        base,
        Message.PressedCalendarKey({
          alt: false,
          key: "e",
          mod: false,
          now: 10,
          shift: false,
        })
      ).model;

      const requested = update(
        prefix,
        Message.PressedCalendarKey({
          alt: false,
          key,
          mod: false,
          now: 11,
          shift: false,
        })
      );

      const { command } = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ command: EditingCommand, personId: Schema.String })
      )(requested.commands?.[0]?.args);

      if (!EditingCommand.guards.Rsvp(command)) {
        return yield* Effect.die(
          new Error("registry did not dispatch typed RSVP")
        );
      }

      expect(command.response).toBe(response);
      yield* step(h.actor, {
        event: Option.some(command.event),
        type: "FOCUS",
      });
      yield* step(h.actor, { note: "Fixture note", type: "NOTE" });
      yield* step(h.actor, {
        event: Option.some(command.event),
        type: "FOCUS",
      });
      yield* step(h.actor, { response: command.response, type: "CHOOSE" });
      yield* snapshots(h.actor).pipe(
        Stream.filter((snapshot) => snapshot.context.result !== undefined),
        Stream.runHead
      );
      expect(h.calls).toEqual([
        {
          accountId: command.event.accountId,
          calendarId: command.event.calendarId,
          eventId: command.event.eventId,
          note: "Fixture note",
          response,
          sendUpdates: "none",
        },
      ]);

      return yield* Effect.void;
    })
);

it.effect(
  "same-event focus preserves the note and switching selection clears it",
  () =>
    Effect.gen(function* isolatedResponseSequence() {
      const h = yield* harness();
      yield* step(h.actor, {
        event: Option.some(editorOriginal),
        type: "FOCUS",
      });
      yield* step(h.actor, { note: "First meeting note", type: "NOTE" });
      yield* step(h.actor, {
        event: Option.some(editorOriginal),
        type: "FOCUS",
      });
      expect(h.actor.getSnapshot().context.note).toBe("First meeting note");
      yield* step(h.actor, {
        event: Option.some({ ...editorOriginal, eventId: "different" }),
        type: "FOCUS",
      });
      expect(h.actor.getSnapshot().matches("idle")).toBe(true);
      expect(h.actor.getSnapshot().context.note).toBe("");
    })
);

it.effect(
  "RSVP refuses a non-attendee and preserves typed rejection instead of a saved result",
  () =>
    Effect.gen(function* refusedResponse() {
      const h = yield* harness(true);
      yield* step(h.actor, {
        event: Option.some({ ...editorOriginal, attendees: [] }),
        type: "FOCUS",
      });
      yield* step(h.actor, { response: "accepted", type: "CHOOSE" });
      expect(h.calls).toHaveLength(0);
      yield* step(h.actor, {
        event: Option.some(editorOriginal),
        type: "FOCUS",
      });
      yield* step(h.actor, { response: "declined", type: "CHOOSE" });

      const snapshot = yield* snapshots(h.actor).pipe(
        Stream.filter((value) => value.context.result !== undefined),
        Stream.runHead,
        Effect.flatMap((value) => Effect.fromOption(value))
      );

      expect(RsvpResult.guards.Failed(snapshot.context.result)).toBe(true);

      if (RsvpResult.guards.Failed(snapshot.context.result)) {
        expect(snapshot.context.result.failure).toEqual(h.failure);
      }
    })
);
