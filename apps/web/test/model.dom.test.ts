import { expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import { vi } from "vitest";

import { Message, initialModel, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { calendarKey } from "../src/client/calendar-state.js";
import {
  ReadPreferences,
  SavePreferences,
  ScrollToNow,
} from "../src/client/commands.js";
import { normalizePreferences } from "../src/client/settings/model.js";
import { dayFromIso, visibleDays } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureEvents, fixtureModel } from "./fixture.js";

const applyMessage = (model: AppModel, message: AppMessage): AppModel => {
  const { model: next } = update(model, message);

  return next;
};

it.effect.prop(
  "generated page histories never accept results from an older visible range",
  {
    moves: Schema.Array(Schema.Boolean),
    staleFirst: Schema.Boolean,
  },
  ({ moves, staleFirst }) =>
    Effect.sync(() => {
      const initial = fixtureModel();
      let { model } = update(initial, Message.ClickedPage({ direction: 1 }));

      for (const forward of moves.slice(0, 30)) {
        model = applyMessage(
          model,
          Message.ClickedPage({ direction: forward ? 1 : -1 })
        );
      }

      const stale = Message.ReceivedEvents({
        accountId: "work",
        request: 1,
        result: {
          events: fixtureEvents.map((event) => ({
            ...event,
            title: "Stale result",
          })),
          versions: [],
        },
      });

      const fresh = Message.ReceivedEvents({
        accountId: "work",
        request: model.calendar.rangeRequest,
        result: {
          events: fixtureEvents
            .filter((event) => event.accountId === "work")
            .map((event) => ({ ...event, title: "Latest result" })),
          versions: [],
        },
      });

      for (const message of staleFirst ? [stale, fresh] : [fresh, stale]) {
        model = applyMessage(model, message);
      }

      expect(
        visibleEvents(model).some((event) => event.title === "Stale result")
      ).toBe(false);
      expect(
        visibleEvents(model).some((event) => event.title === "Latest result")
      ).toBe(true);
    })
);

it.effect("a failed account leaves another account's events visible", () =>
  Effect.sync(() => {
    const { model } = update(
      fixtureModel(),
      Message.FailedEvents({
        accountId: "work",
        failure: { kind: "retry", message: "Provider unavailable" },
        request: 1,
      })
    );

    expect(
      visibleEvents(model).some((event) => event.title === "Lunch with Sam")
    ).toBe(true);
    expect(
      visibleEvents(model).some((event) => event.title === "Product review")
    ).toBe(false);
    expect(
      model.calendar.reads.find((read) => read.accountId === "work")?.events
        ._tag
    ).toBe("Failure");
  })
);

it.effect(
  "view keys, hidden weekends, Today and month paging update the Model",
  () =>
    Effect.sync(() => {
      let model = fixtureModel();
      model = applyMessage(
        model,
        Message.PressedCalendarKey({
          alt: false,
          key: "D",
          mod: false,
          shift: false,
        })
      );
      expect(visibleDays(model.calendar.navigation)).toEqual([
        dayFromIso("2026-10-21"),
      ]);
      model = applyMessage(
        model,
        Message.PressedCalendarKey({
          alt: false,
          key: "9",
          mod: false,
          shift: false,
        })
      );
      expect(visibleDays(model.calendar.navigation)).toHaveLength(9);
      model = applyMessage(model, Message.ClickedWeekends());
      expect(visibleDays(model.calendar.navigation)).toHaveLength(9);
      model = applyMessage(
        model,
        Message.PressedCalendarKey({
          alt: false,
          key: "0",
          mod: false,
          shift: false,
        })
      );
      expect(visibleDays(model.calendar.navigation)).toHaveLength(5);
      model = applyMessage(
        model,
        Message.ClickedView({ days: 7, mode: "month" })
      );
      model = applyMessage(
        model,
        Message.PressedCalendarKey({
          alt: false,
          key: "ArrowDown",
          mod: false,
          shift: false,
        })
      );
      expect(model.calendar.navigation.anchor).toBe(dayFromIso("2026-11-01"));
      model = applyMessage(model, Message.ClickedToday());
      expect(model.calendar.navigation.anchor).toBe(dayFromIso("2026-10-01"));
    })
);

it.effect(
  "visibility persists for one opaque person id without leaking to another",
  () =>
    Effect.gen(function* visibilityPreferences() {
      localStorage.clear();
      const hidden = [calendarKey("work", "primary")];
      yield* SavePreferences({
        ...normalizePreferences({ hidden, mergeDuplicates: false }),
        person: "person-one",
      }).effect;
      const own = yield* ReadPreferences({ person: "person-one" }).effect;
      const other = yield* ReadPreferences({ person: "person-two" }).effect;

      expect(own).toEqual(
        Message.ReceivedPreferences({
          person: "person-one",
          preferences: normalizePreferences({ hidden, mergeDuplicates: false }),
        })
      );

      const loaded = update(
        { ...fixtureModel(), person: Option.some("person-one") },
        own
      ).model;

      expect(loaded.calendar.mergeDuplicates).toBe(false);
      expect(loaded.calendar.hidden).toEqual(hidden);
      expect(other).toEqual(
        Message.ReceivedPreferences({
          person: "person-two",
          preferences: normalizePreferences({ version: 2, visibility: {} }),
        })
      );

      localStorage.setItem(
        "calendar.visibility.legacy-person",
        JSON.stringify({ hidden })
      );
      expect(
        yield* ReadPreferences({ person: "legacy-person" }).effect
      ).toEqual(
        Message.ReceivedPreferences({
          person: "legacy-person",
          preferences: normalizePreferences({ hidden }),
        })
      );

      const off = update(
        fixtureModel(),
        Message.ClickedMergeDuplicates()
      ).model;

      const result = update(
        off,
        Message.ClickedCalendar({ accountId: "work", calendarId: "primary" })
      );

      expect(
        result.commands?.find((command) => command.name === "SavePreferences")
          ?.args?.mergeDuplicates
      ).toBe(false);

      expect(
        visibleEvents(result.model).some(
          (event) => event.title === "Product review"
        )
      ).toBe(false);
      expect(
        result.commands?.some((command) => command.name === "SavePreferences")
      ).toBe(true);
      localStorage.setItem(
        "calendar.visibility.person-two",
        '{"hidden":false}'
      );
      expect(yield* ReadPreferences({ person: "person-two" }).effect).toEqual(
        Message.FailedPreferences({ person: "person-two" })
      );
      localStorage.clear();
    })
);

it.effect(
  "receiving a signed-out session clears event data and the person preference key",
  () =>
    Effect.sync(() => {
      const { model } = update(
        fixtureModel(),
        Message.ReceivedSession({ snapshot: null })
      );

      expect(model.person).toEqual(Option.none());
      expect(visibleEvents(model)).toHaveLength(0);
      expect(model.calendar.hidden).toHaveLength(0);
    })
);

it.effect(
  "DST navigation issues calendar-midnight RPC bounds instead of adding 168 hours",
  () =>
    Effect.gen(function* rpcDateBounds() {
      for (const [date, hours] of [
        ["2026-03-08", 167],
        ["2026-11-01", 169],
      ] as const) {
        const now = DateTime.toEpochMillis(
          DateTime.makeUnsafe(`${date}T12:00:00-07:00`)
        );

        const base = initialModel(now, "America/Los_Angeles");

        const result = update(
          {
            ...base,
            calendar: {
              ...base.calendar,
              calendars: fixtureModel().calendar.calendars,
            },
          },
          Message.CalendarChanged()
        );

        const args = result.commands?.find(
          (command) => command.name === "ReadEvents"
        )?.args;

        const range = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ end: Schema.String, start: Schema.String })
        )(args?.range);

        const duration =
          DateTime.toEpochMillis(DateTime.makeUnsafe(range.end)) -
          DateTime.toEpochMillis(DateTime.makeUnsafe(range.start));

        expect(duration / 3_600_000).toBe(hours);
        expect(
          result.model.calendar.reads.every((read) =>
            AsyncData.isLoading(read.events)
          )
        ).toBe(true);
      }
    })
);

it.effect(
  "late-afternoon Today scrolling waits for a frame and clamps to the real viewport bottom",
  () =>
    Effect.gen(function* clampedTodayScroll() {
      const now = DateTime.toEpochMillis(
        DateTime.makeUnsafe("2026-10-19T16:04:35-07:00")
      );

      const base = fixtureModel();

      const model = {
        ...base,
        calendar: { ...base.calendar, now, viewport: 844 },
      };

      const result = update(model, Message.ClickedToday());

      const args = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ minute: Schema.Finite, scale: Schema.Finite })
      )(
        result.commands?.find((command) => command.name === "ScrollToNow")?.args
      );

      const viewport = document.createElement("div");
      viewport.id = "time-viewport";
      Object.defineProperty(viewport, "clientHeight", { value: 770 });
      Object.defineProperty(viewport, "scrollHeight", { value: 1152 });
      document.body.append(viewport);
      vi.stubGlobal(
        "requestAnimationFrame",
        (onFrame: FrameRequestCallback) => {
          expect(viewport.scrollTop).toBe(0);
          onFrame(0);

          return 1;
        }
      );

      try {
        expect(args.scale).toBe(48);
        expect(args.minute).toBeCloseTo(964 + 35 / 60);
        yield* ScrollToNow(args).effect;
        expect(viewport.scrollTop).toBe(382);
        expect(
          (args.minute * args.scale) / 60 - viewport.scrollTop
        ).toBeCloseTo(389.6667, 3);
        expect(
          update(result.model, Message.Ticked({ now: now + 60_000 })).commands
        ).toBeUndefined();
      } finally {
        vi.unstubAllGlobals();
        viewport.remove();
      }
    })
);
