import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { gestureTarget } from "../src/client/editing/gesture-input.js";
import { monthHostKey } from "../src/client/month/host.js";
import { gestureRange } from "../src/layout/gesture-range.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureModel } from "./fixture.js";

it.effect.prop(
  "month completion moves only the grabbed member and preserves the ordered selection while stale people, hosts and permissions refuse writes",
  {
    days: Schema.Int.check(Schema.isBetween({ maximum: 20, minimum: -20 })),
    rotation: Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 })),
  },
  ({ days, rotation }) =>
    Effect.sync(() => {
      const base = fixtureModel();

      const initial = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: { ...base.calendar.navigation, mode: "month" as const },
          reads: base.calendar.reads.map((read) => {
            const data = Option.getOrThrow(AsyncData.getData(read.events));

            return {
              ...read,
              events: RemoteEvents.Success({
                data: {
                  ...data,
                  events: data.events.map((event) => ({
                    ...event,
                    organizer: { email: "owner@example.test", self: true },
                  })),
                },
              }),
            };
          }),
        },
      };

      const events = visibleEvents(initial).slice(0, 3);
      const grabbed = events[rotation];

      if (grabbed === undefined) {
        throw new Error("Missing selected gesture fixture");
      }

      const selected = [
        ...events.slice(rotation),
        ...events.slice(0, rotation),
      ].map((event) => event.key);

      const model = { ...initial, calendar: { ...initial.calendar, selected } };

      const captured = Option.getOrThrow(
        gestureTarget(grabbed, model.calendar.zone)
      );

      const point = {
        alt: false,
        at: 1,
        day: grabbed.startDay,
        minute: 0,
        pointerId: 1,
        shift: false,
        x: 0,
        y: 0,
      };

      const gesture = gestureRange(
        { allDay: true, edge: "body", point, target: Option.some(captured) },
        { ...point, day: grabbed.startDay + days, x: 20 },
        1
      );

      const personId = Option.getOrThrow(model.person);
      const hostKey = Option.getOrThrow(monthHostKey(model));
      const message = Message.CompletedGesture({ gesture, hostKey, personId });
      const result = update(model, message);
      expect(result.model.calendar.selected).toEqual(selected);
      expect(result.commands).toHaveLength(1);
      expect(result.commands?.[0]?.args).toMatchObject({
        command: {
          request: {
            event: { eventId: grabbed.source.eventId },
            range: gesture.range,
          },
        },
      });

      for (const stale of [
        { ...model, person: Option.some("another-person") },
        { ...model, calendar: { ...model.calendar, zone: "UTC" } },
        {
          ...model,
          calendar: {
            ...model.calendar,
            calendars: model.calendar.calendars.map((calendar) => ({
              ...calendar,
              accessRole: "reader" as const,
            })),
          },
        },
      ]) {
        const refused = update(stale, message);
        expect(refused.commands ?? []).toHaveLength(0);
        expect(refused.model.calendar.selected).toEqual(selected);
      }

      const refused = update(
        model,
        Message.RefusedGesture({ hostKey, personId, reason: "ReadOnlyEvent" })
      ).model;

      expect(Option.getOrThrow(refused.editing.gestureRefusal)).toBe(
        "ReadOnlyEvent"
      );
      expect(refused.calendar.selected).toEqual(selected);
    })
);
