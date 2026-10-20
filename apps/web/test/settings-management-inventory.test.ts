import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import { calendarKey } from "../src/client/calendar-state.js";
import { LiveNotice } from "../src/client/live/protocol.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { fixtureIndex, fixtureModel } from "./fixture.js";

it.effect(
  "an authoritative inventory removal drops the open tab's account and grid data, and late inventory cannot resurrect that connection",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();
      const personId = Option.getOrThrow(base.person);

      const result = {
        accounts: fixtureIndex.accounts.filter(
          (account) => account.accountId !== "work"
        ),
      };

      const noticed = update(
        base,
        Message.ReceivedLive({
          notice: LiveNotice.cases.InventoryChanged.make({}),
          personId,
        })
      );

      expect(
        noticed.commands?.find((command) => command.name === "ReadCalendars")
          ?.args
      ).toEqual({ personId });

      const next = update(
        noticed.model,
        Message.ReceivedCalendars({ personId, result })
      ).model;

      expect(
        Option.getOrUndefined(AsyncData.getData(next.session))?.accounts.some(
          (account) => account.id === "work"
        )
      ).toBe(false);
      expect(
        next.calendar.calendars.some(
          (calendar) => calendar.accountId === "work"
        )
      ).toBe(false);
      expect(
        next.calendar.reads.some((read) => read.accountId === "work")
      ).toBe(false);
      expect(
        visibleEvents(next).some((event) =>
          event.copies.some((copy) => copy.source.accountId === "work")
        )
      ).toBe(false);

      const late = update(
        next,
        Message.ReceivedCalendars({ personId, result: fixtureIndex })
      ).model;

      expect(
        late.calendar.calendars.some(
          (calendar) => calendar.accountId === "work"
        )
      ).toBe(false);
      expect(
        Option.getOrUndefined(AsyncData.getData(late.session))?.accounts.some(
          (account) => account.id === "work"
        )
      ).toBe(false);
    })
);

it.effect(
  "a prior person's inventory success or failure is ignored before upcoming and reminder projections run",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();
      const personId = "different-person";

      for (const message of [
        Message.ReceivedCalendars({ personId, result: fixtureIndex }),
        Message.FailedCalendars({
          failure: { kind: "retry", message: "Old failure" },
          personId,
        }),
      ]) {
        const result = update(base, message);
        expect(result).toEqual({ model: base });
      }
    })
);

it.effect(
  "new calendars follow Google's selected default, while a local shown choice survives later inventory reads",
  () =>
    Effect.sync(() => {
      const base = fixtureModel();
      const personId = Option.getOrThrow(base.person);

      const work = fixtureIndex.accounts.find(
        (account) => account.accountId === "work"
      );

      if (work === undefined || !("calendars" in work)) {
        throw new Error("Expected work inventory");
      }

      const [first] = work.calendars;

      if (first === undefined) {
        throw new Error("Expected source calendar");
      }

      const added = { ...first, calendarId: "new-calendar", selected: false };

      const result = {
        accounts: fixtureIndex.accounts.map((account) =>
          account.accountId === "work"
            ? { ...work, calendars: [...work.calendars, added] }
            : account
        ),
      };

      const loaded = update(
        base,
        Message.ReceivedCalendars({ personId, result })
      ).model;

      const key = calendarKey("work", "new-calendar");
      expect(loaded.calendar.hidden).toContain(key);
      expect(loaded.calendar.visibility[key]).toBeUndefined();

      const shown = update(
        loaded,
        Message.ClickedCalendar({
          accountId: "work",
          calendarId: "new-calendar",
        })
      ).model;

      expect(shown.calendar.visibility[key]).toBe(true);
      expect(shown.calendar.hidden).not.toContain(key);

      const reloaded = update(
        shown,
        Message.ReceivedCalendars({ personId, result })
      ).model;

      expect(reloaded.calendar.hidden).not.toContain(key);
      expect(reloaded.calendar.visibility[key]).toBe(true);
    })
);
