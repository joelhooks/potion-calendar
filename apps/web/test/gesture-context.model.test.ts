import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Message, update } from "../src/client/app.js";
import { gestureTarget } from "../src/client/editing/gesture-input.js";
import { GestureResult } from "../src/client/editing/gesture-model.js";
import {
  modelGestureHostKey,
  modelGestureInputs,
} from "../src/client/editing/gesture-targets.js";
import { completeGesture } from "../src/client/editing/update.js";
import { TimeZoneAction } from "../src/client/time-zones/model.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { CalendarRoute, SearchRoute } from "../src/layout/route.js";
import { displayZone } from "../src/layout/time-zones.js";
import { copyEvent, copyFixtureModel } from "./equivalent-fixture.js";
import { fixtureSelection } from "./fixture.js";

it.effect(
  "late gesture previews and completions from another active-zone host cannot create or move anything",
  () =>
    Effect.sync(() => {
      const base = fixtureSelection();
      const personId = Option.getOrThrow(base.person);
      const hostKey = Option.getOrThrow(modelGestureHostKey(base));

      const gesture = GestureResult.make({
        allDayRow: false,
        duplicate: false,
        id: 1,
        range: {
          allDay: false,
          endDate: "2026-10-19",
          endTime: "10:00",
          startDate: "2026-10-19",
          startTime: "09:00",
        },
        target: Option.none(),
      });

      const current = update(
        base,
        Message.TimeZoneAction({
          action: TimeZoneAction.cases.Travel.make({
            zone: displayZone("Asia/Tokyo"),
          }),
        })
      ).model;

      for (const message of [
        Message.PreviewedGesture({
          hostKey,
          personId,
          preview: Option.some(gesture),
        }),
        Message.CompletedGesture({ gesture, hostKey, personId }),
      ]) {
        const result = update(current, message);
        expect(result.commands).toBeUndefined();
        expect(result.model).toEqual(current);
      }
    })
);

it.effect(
  "the getter lease becomes inactive on Search and active again when the calendar returns",
  () =>
    Effect.sync(() => {
      const base = fixtureSelection();
      const search = { ...base, route: SearchRoute.make({ q: "planning" }) };
      expect(Option.isSome(modelGestureInputs(base).key)).toBe(true);
      expect(Option.isNone(modelGestureInputs(search).key)).toBe(true);
      const restored = { ...search, route: CalendarRoute.make({}) };
      expect(modelGestureInputs(restored).key).toEqual(
        modelGestureInputs(base).key
      );
    })
);

it.effect(
  "a merged event cannot retarget another equivalent copy when the captured provider reference disappears",
  () =>
    Effect.sync(() => {
      const work = copyEvent(
        { accountId: "work", calendarId: "primary" },
        { organizer: { email: "owner@example.test", self: true } }
      );

      const personal = copyEvent(
        { accountId: "personal", calendarId: "personal" },
        { organizer: { email: "owner@example.test", self: true } }
      );

      const before = copyFixtureModel([work, personal]);
      const [item] = visibleEvents(before);
      expect(item?.copies).toHaveLength(2);

      if (item === undefined) {
        throw new Error("Expected merged event");
      }

      const target = Option.getOrThrow(
        gestureTarget(item, before.calendar.zone)
      );

      expect(target.event.accountId).toBe("work");

      const gesture = GestureResult.make({
        allDayRow: false,
        duplicate: false,
        id: 1,
        range: {
          allDay: false,
          endDate: "2026-10-19",
          endTime: "12:00",
          startDate: "2026-10-19",
          startTime: "11:00",
        },
        target: Option.some(target),
      });

      const current = copyFixtureModel([personal]);
      expect(visibleEvents(current)[0]?.key).toBe(item.key);
      const result = completeGesture(current, gesture);
      expect(result.commands).toBeUndefined();
      expect(Option.getOrUndefined(result.model.error)).toMatch(
        /no longer available/iu
      );
    })
);
