import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../src/client/app.js";
import { Message, reloadRange, update } from "../src/client/app.js";
import { eventKey } from "../src/client/calendar-state.js";
import {
  monthFrame,
  monthHostKey,
  monthNavigation,
} from "../src/client/month/host.js";
import { MonthNotice } from "../src/client/month/model.js";
import { retainedMonthSources } from "../src/client/month/update.js";
import {
  boundedMonthScrollTop,
  initialMonthPosition,
  monthScrollLimits,
  settledMonthAnchor,
} from "../src/layout/month-window.js";
import {
  displayDayBounds,
  partsFromDay,
  periodStart,
} from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { copyFixtureEvents, copyFixtureModel } from "./equivalent-fixture.js";
import { fixtureEvents, fixtureModel } from "./fixture.js";

const bounded = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum }));

it.effect.prop(
  "settled month labels and Next/J share the desk-default midpoint anchor and snap to the following month's grid",
  {
    fraction: bounded(0, 99),
    rowHeight: bounded(1, 400),
    rows: bounded(0, 12),
    weeks: bounded(-300, 300),
  },
  ({ weeks, rowHeight, rows, fraction }) =>
    Effect.sync(() => {
      const base = fixtureModel();

      let model: AppModel = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: { ...base.calendar.navigation, mode: "month" },
        },
      };

      const session = {
        hostKey: Option.getOrThrow(monthHostKey(model)),
        id: 1,
      };

      const firstWeek = periodStart(model.calendar.navigation) + weeks * 7;
      const scrollTop = (rows + fraction / 100) * rowHeight;
      const anchor = settledMonthAnchor({ firstWeek, scrollTop }, rowHeight);
      ({ model } = update(
        model,
        Message.ReceivedMonth({
          notice: MonthNotice.cases.Frame.make({
            frame: { firstWeek, pinnedWeek: Option.none(), revision: 0 },
            session,
          }),
        })
      ));
      ({ model } = update(
        model,
        Message.ReceivedMonth({
          notice: MonthNotice.cases.Settled.make({ anchor, session }),
        })
      ));
      const label = partsFromDay(monthNavigation(model).anchor);

      const midpoint = partsFromDay(
        firstWeek + Math.floor(scrollTop / rowHeight) * 7 + 21
      );

      expect([label.year, label.month, label.day]).toEqual([
        midpoint.year,
        midpoint.month,
        1,
      ]);

      for (const message of [
        Message.ClickedPage({ direction: 1 }),
        Message.PressedCalendarKey({
          alt: false,
          key: "j",
          mod: false,
          shift: false,
        }),
      ]) {
        const next = update(model, message).model;
        const nextMonth = partsFromDay(next.calendar.navigation.anchor);
        expect(nextMonth.year * 12 + nextMonth.month).toBe(
          label.year * 12 + label.month + 1
        );
        expect(monthFrame(next).firstWeek + 42).toBe(
          periodStart(next.calendar.navigation)
        );
      }
    })
);

it.effect.prop(
  "month native offsets stay inside the existing display domain for every week start without rebasing the pointer beyond a boundary",
  {
    offset: bounded(-1_000_000, 1_000_000),
    rowHeight: bounded(1, 400),
    startsOn: bounded(0, 6),
    week: bounded(0, 1200),
  },
  ({ week, startsOn, rowHeight, offset }) =>
    Effect.sync(() => {
      const limits = monthScrollLimits(startsOn);

      const position = initialMonthPosition(
        limits.firstWeek + week * 7,
        rowHeight
      );

      const scrollTop = boundedMonthScrollTop(
        position.firstWeek,
        offset,
        rowHeight,
        limits
      );

      const visible = position.firstWeek + (scrollTop / rowHeight) * 7;
      expect(visible).toBeGreaterThanOrEqual(limits.firstWeek - 0.000001);
      expect(visible).toBeLessThanOrEqual(limits.lastWeek + 0.000001);
      expect(
        boundedMonthScrollTop(position.firstWeek, scrollTop, rowHeight, limits)
      ).toBe(scrollTop);
      expect(limits.firstWeek).toBeLessThanOrEqual(displayDayBounds.start);
      expect(limits.firstWeek + 7).toBeGreaterThan(displayDayBounds.start);
      expect(limits.lastWeek + 42).toBeGreaterThanOrEqual(displayDayBounds.end);
      expect(limits.lastWeek + 35).toBeLessThan(displayDayBounds.end);
    })
);

it.effect.prop(
  "session replacement never reuses a range request identity and old replies cannot populate the replacement person's display",
  { otherPerson: Schema.Boolean, replacements: bounded(1, 8) },
  ({ replacements, otherPerson }) =>
    Effect.sync(() => {
      let model = fixtureModel();
      const snapshot = Option.getOrThrow(AsyncData.getData(model.session));

      if (snapshot === null) {
        throw new Error("The fixture must be authenticated");
      }

      for (let index = 0; index < replacements; index += 1) {
        const oldRequest = model.calendar.rangeRequest;
        ({ model } = update(
          model,
          Message.ReceivedSession({ snapshot: null })
        ));

        const nextSnapshot =
          otherPerson && index % 2 === 0
            ? {
                ...snapshot,
                user: { ...snapshot.user, id: "replacement-person" },
              }
            : snapshot;

        ({ model } = update(
          model,
          Message.ReceivedSession({ snapshot: nextSnapshot })
        ));
        ({ model } = reloadRange({
          ...model,
          calendar: {
            ...model.calendar,
            calendars: fixtureModel().calendar.calendars,
          },
        }));
        expect(model.calendar.rangeRequest).toBeGreaterThan(oldRequest);
        const before = model.calendar.reads;
        ({ model } = update(
          model,
          Message.ReceivedEvents({
            accountId: "work",
            request: oldRequest,
            result: { events: fixtureEvents, versions: [] },
          })
        ));
        expect(model.calendar.reads).toBe(before);
      }
    })
);

it.effect.prop(
  "equivalent selected source facts survive only coverage exclusion and never mask an authoritative absence inside the new range",
  { offset: bounded(2, 90) },
  ({ offset }) =>
    Effect.sync(() => {
      const base = copyFixtureModel();

      const selected = visibleEvents(base).find(
        (event) => !event.allDay && event.copies.length === 2
      );

      if (selected === undefined) {
        throw new Error("The fixture must contain the selected event");
      }

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          navigation: { ...base.calendar.navigation, mode: "month" as const },
          selected: Option.some(selected.key),
        },
        month: {
          ...base.month,
          range: Option.some({
            end: selected.endDay + offset + 126,
            start: selected.endDay + offset,
          }),
        },
      };

      const expected = new Set(
        selected.copies.map((copy) => eventKey(copy.source))
      );

      expect(expected.size).toBe(2);
      expect([...expected].every((key) => key !== selected.key)).toBe(true);
      const retained = retainedMonthSources(model, copyFixtureEvents, []);
      expect(new Set(retained.map(eventKey))).toEqual(expected);
      expect(retainedMonthSources(model, copyFixtureEvents, retained)).toEqual(
        retained
      );
      expect(
        retainedMonthSources(
          {
            ...model,
            month: {
              ...model.month,
              range: Option.some({
                end: selected.endDay + 1,
                start: selected.startDay - 1,
              }),
            },
          },
          copyFixtureEvents,
          []
        )
      ).toEqual([]);
    })
);

it.effect.prop(
  "the actor's initial coverage intent joins an existing range read and acknowledges exactly once after every account settles",
  { failFirst: Schema.Boolean },
  ({ failFirst }) =>
    Effect.sync(() => {
      const base = fixtureModel();

      const loaded = reloadRange({
        ...base,
        calendar: {
          ...base.calendar,
          navigation: { ...base.calendar.navigation, mode: "month" as const },
        },
      });

      const session = {
        hostKey: Option.getOrThrow(monthHostKey(loaded.model)),
        id: 1,
      };

      const frame = {
        firstWeek: Option.getOrThrow(loaded.model.month.range).start,
        pinnedWeek: Option.none<number>(),
        revision: 0,
      };

      let { model } = update(
        loaded.model,
        Message.ReceivedMonth({
          notice: MonthNotice.cases.Frame.make({ frame, session }),
        })
      );

      const request = { id: 1, range: Option.getOrThrow(model.month.range) };

      const joined = update(
        model,
        Message.ReceivedMonth({
          notice: MonthNotice.cases.Read.make({ request, session }),
        })
      );

      expect(joined.commands ?? []).toHaveLength(0);
      ({ model } = joined);
      let acknowledgements = 0;

      for (const [index, read] of loaded.model.calendar.reads.entries()) {
        const result = update(
          model,
          index === 0 && failFirst
            ? Message.FailedEvents({
                accountId: read.accountId,
                failure: { kind: "retry", message: "Synthetic read failure" },
                request: model.calendar.rangeRequest,
              })
            : Message.ReceivedEvents({
                accountId: read.accountId,
                request: model.calendar.rangeRequest,
                result: { events: [], versions: [] },
              })
        );

        const commands = result.commands ?? [];
        expect(
          commands.every((command) => command.name === "AcknowledgeMonthRead")
        ).toBe(true);
        acknowledgements += commands.length;
        ({ model } = result);
        expect(Option.isSome(model.month.pending)).toBe(
          index < loaded.model.calendar.reads.length - 1
        );
      }

      expect(acknowledgements).toBe(1);
      expect(model.calendar.rangeRequest).toBe(
        loaded.model.calendar.rangeRequest
      );

      if (failFirst) {
        expect(
          model.calendar.reads.some((read) => AsyncData.isStale(read.events))
        ).toBe(true);
      }
    })
);
