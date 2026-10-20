import { watchActor } from "@calendar/capability/actor-watch";
import { expect, it } from "@effect/vitest";
import { createEffectActor, send } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Effect, Option, Queue, Result, Schema } from "effect";

import { gestureMachine } from "../src/client/editing/gesture-machine.js";
import {
  GesturePoint,
  GestureResult,
  GestureTarget,
} from "../src/client/editing/gesture-model.js";
import {
  MonthGestureInput,
  monthGestureStart,
} from "../src/client/month/gesture.js";
import { monthGesturePreview } from "../src/layout/month-gesture-preview.js";
import { dayFromIso, isoFromDay } from "../src/layout/navigation.js";
import { editorOriginal } from "./editor-fixture.js";

const day = dayFromIso("2026-10-19");

const bounded = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum }));

const point = (offset: number, alt = false, x = 12) =>
  GesturePoint.make({
    alt,
    at: 1000,
    day: day + offset,
    minute: 0,
    pointerId: 7,
    shift: false,
    x,
    y: 0,
  });

const targetFor = (allDay: boolean, editable: boolean, length: number) =>
  GestureTarget.make({
    allDay,
    editable,
    end: (day + (allDay ? length : 0)) * 1440 + (allDay ? 0 : 597),
    event: {
      ...editorOriginal,
      end: allDay
        ? { date: isoFromDay(day + length) }
        : { dateTime: "2026-10-19T09:57:00-07:00" },
      start: allDay
        ? { date: isoFromDay(day) }
        : { dateTime: "2026-10-19T09:07:00-07:00" },
    },
    key: "month-source",
    start: day * 1440 + (allDay ? 0 : 547),
  });

type Actor = EffectActor<typeof gestureMachine>;

const step = Effect.fn("monthGestureHistoryStep")(function* step(
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

it.effect.prop(
  "month activation refuses unselected, read-only and unsupported resize intents before arming the existing actor",
  {
    allDay: Schema.Boolean,
    alt: Schema.Boolean,
    edge: MonthGestureInput.fields.edge,
    editable: Schema.Boolean,
    present: Schema.Boolean,
    selected: Schema.Boolean,
  },
  ({ allDay, editable, selected, alt, present, edge }) =>
    Effect.gen(function* activation() {
      const target = present
        ? Option.some(targetFor(allDay, editable, 3))
        : Option.none();

      const outcome = monthGestureStart(
        MonthGestureInput.make({
          edge,
          point: point(0, alt, 0),
          selected,
          target,
        })
      );

      const permitted = present
        ? selected &&
          (editable || (alt && edge === "body")) &&
          (edge === "body" || allDay)
        : edge === "body";

      expect(Result.isSuccess(outcome)).toBe(permitted);
      const actor = yield* createEffectActor(gestureMachine);
      yield* watchActor("calendar.month.activation.test", actor);

      if (Result.isSuccess(outcome)) {
        expect(outcome.success.allDay).toBe(true);
        yield* step(actor, { start: outcome.success, type: "DOWN" });
        expect(actor.getSnapshot().value).toBe("armed");
        expect(actor.getSnapshot().context.preview).toBeUndefined();
      } else {
        expect(outcome.failure._tag).toBe("MonthGestureRefused");
        expect(actor.getSnapshot().value).toBe("idle");
      }
    })
);

it.effect.prop(
  "generated month move and horizontal resize histories preserve clocks, endpoint ownership, cancellation and commit sequencing",
  {
    allDay: Schema.Boolean,
    edge: MonthGestureInput.fields.edge,
    history: Schema.Array(
      Schema.Struct({
        alt: Schema.Boolean,
        command: Schema.Literals(["down", "move", "up", "cancel"]),
        offset: bounded(-20, 30),
      })
    ).check(Schema.isMaxLength(30)),
    length: bounded(1, 20),
  },
  ({ allDay, length, edge, history }) =>
    Effect.gen(function* histories() {
      const resizeEdge = allDay ? edge : "body";
      const source = targetFor(allDay, true, length);

      const started = Result.getOrThrow(
        monthGestureStart(
          MonthGestureInput.make({
            edge: resizeEdge,
            point: point(0, false, 0),
            selected: true,
            target: Option.some(source),
          })
        )
      );

      const actor = yield* createEffectActor(gestureMachine);
      yield* watchActor("calendar.month.history.test", actor);
      let phase = "idle";
      let sequence = 0;
      let lastCompleted: typeof GestureResult.Type | undefined;

      const expected = (offset: number, alt: boolean) => {
        let from = day;
        let to = day + (allDay ? length : 0);

        if (resizeEdge === "body") {
          from += offset;
          to += offset;
        } else if (resizeEdge === "start") {
          from = Math.min(day + offset, to - 1);
        } else {
          to = Math.max(day + offset + 1, from + 1);
        }

        return {
          allDayRow: true,
          duplicate: alt && resizeEdge === "body",
          id: sequence + 1,
          range: {
            allDay,
            endDate: isoFromDay(to - Number(allDay)),
            endTime: allDay ? "00:00" : "09:57",
            startDate: isoFromDay(from),
            startTime: allDay ? "00:00" : "09:07",
          },
          target: Option.some(source),
        };
      };

      for (const command of history) {
        if (command.command === "down") {
          yield* step(actor, { start: started, type: "DOWN" });

          if (phase === "idle") {
            phase = "armed";
          }
        } else if (command.command === "cancel") {
          yield* step(actor, { type: "CANCEL" });
          phase = "idle";
        } else if (command.command === "move") {
          yield* step(actor, {
            point: point(command.offset, command.alt),
            type: "MOVE",
          });

          if (phase !== "idle") {
            phase = "dragging";
            expect(actor.getSnapshot().context.preview).toEqual(
              expected(command.offset, command.alt)
            );
          }
        } else {
          const completion =
            phase === "dragging"
              ? expected(command.offset, command.alt)
              : undefined;

          yield* step(actor, {
            point: point(command.offset, command.alt),
            type: "UP",
          });

          if (completion !== undefined) {
            lastCompleted = completion;
            sequence += 1;
          }

          phase = "idle";
        }

        const snapshot = actor.getSnapshot();
        expect(snapshot.value).toBe(phase);
        expect(snapshot.context.sequence).toBe(sequence);
        expect(snapshot.context.completed).toEqual(lastCompleted);
        expect(snapshot.context.preview !== undefined).toBe(
          phase === "dragging"
        );

        if (phase === "idle") {
          expect(snapshot.context.start).toBeUndefined();
        }

        expect(source.start).toBe(day * 1440 + (allDay ? 0 : 547));
      }
    })
);

it.effect.prop(
  "month preview projection conserves visible dates, skips hidden weekends and splits only at week boundaries",
  {
    allDay: Schema.Boolean,
    duplicate: Schema.Boolean,
    length: bounded(1, 28),
    offset: bounded(-7, 35),
    weekends: Schema.Boolean,
  },
  ({ allDay, weekends, offset, length, duplicate }) =>
    Effect.sync(() => {
      const weeks = Array.from({ length: 6 }, (_, row) =>
        Array.from(
          { length: 7 },
          (_unusedDay, column) => day + row * 7 + column
        ).filter(
          (value) => !weekends || ![0, 6].includes((((value + 4) % 7) + 7) % 7)
        )
      );

      const from = day + offset;
      const end = from + length;

      const preview = GestureResult.make({
        allDayRow: true,
        duplicate,
        id: 1,
        range: {
          allDay,
          endDate: isoFromDay(end - Number(allDay)),
          endTime: allDay ? "00:00" : "00:00",
          startDate: isoFromDay(from),
          startTime: allDay ? "00:00" : "09:07",
        },
        target: Option.none(),
      });

      const segments = monthGesturePreview(Option.some(preview), weeks);

      const projected = segments.flatMap((segment) =>
        (weeks[segment.row] ?? []).slice(segment.startColumn, segment.endColumn)
      );

      expect(projected).toEqual(
        weeks.flat().filter((value) => from <= value && value < end)
      );
      expect(new Set(projected).size).toBe(projected.length);

      for (const segment of segments) {
        expect(segment.allDay).toBe(allDay);
        expect(segment.duplicate).toBe(duplicate);
        expect(segment.endColumn).toBeGreaterThan(segment.startColumn);

        if (!allDay) {
          expect(segment.endColumn - segment.startColumn).toBe(1);
        }
      }

      if (allDay) {
        expect(new Set(segments.map((segment) => segment.row)).size).toBe(
          segments.length
        );
      }

      expect(monthGesturePreview(Option.none(), weeks)).toEqual([]);
      expect(
        monthGesturePreview(
          Option.some({ ...preview, allDayRow: false }),
          weeks
        )
      ).toEqual([]);
    })
);
