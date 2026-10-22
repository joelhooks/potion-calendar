import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { eventKey, RemoteEvents } from "../src/client/calendar-state.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import {
  OccurrenceNotice,
  OccurrenceProblem,
} from "../src/client/selection-commands/model.js";
import { preferenceSnapshot } from "../src/client/settings/update.js";
import { monthWeeks } from "../src/layout/month.js";
import {
  dayFromIso,
  partsFromDay,
  visibleDays,
} from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import {
  beginCommandOccurrence,
  commandNeighbor,
  selectionCommandFixture,
} from "./selection-command-fixture.js";

it.effect.prop(
  "Go to selection navigates to the earliest selected event, preserves selection and never opens the editor",
  {
    mode: Schema.Literals(["day", "week", "days", "month"]),
    reverse: Schema.Boolean,
  },
  ({ reverse, mode }) =>
    Effect.sync(() => {
      const { model, event } = selectionCommandFixture();
      const later = commandNeighbor(event, 4);

      const keys = reverse
        ? [eventKey(later), eventKey(event)]
        : [eventKey(event), eventKey(later)];

      const base = {
        ...model,
        calendar: {
          ...model.calendar,
          navigation: {
            ...model.calendar.navigation,
            anchor: model.calendar.navigation.anchor + 90,
            mode,
          },
          reads: [
            {
              accountId: event.accountId,
              events: RemoteEvents.Success({
                data: { events: [later, event], versions: [] },
              }),
            },
          ],
          selected: keys,
        },
      };

      const open = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const result = update(
        open,
        Message.KeyboardPick({ id: "go-to-selection" })
      );

      expect(result.model.calendar.navigation.anchor).toBe(
        dayFromIso("2026-10-19")
      );
      expect(result.model.calendar.navigation.mode).toBe(mode);
      expect(result.model.calendar.selected).toEqual(keys);
      expect(result.model.editing).toBe(model.editing);
      expect(result.model.keyboard.screen).toBe("closed");
      expect(
        result.commands?.filter(
          (command) => command.name === "ScrollToSelection"
        )
      ).toHaveLength(mode === "month" ? 0 : 1);
    })
);

it.effect.prop(
  "Go to a hidden weekday uses a transient Day reveal without rewriting weekday preferences",
  {
    mode: Schema.Literals(["day", "week", "days"]),
  },
  ({ mode }) =>
    Effect.sync(() => {
      const { model } = selectionCommandFixture();
      const day = dayFromIso("2026-10-19");
      const weekday = partsFromDay(day).weekDay;

      const base = {
        ...model,
        calendar: {
          ...model.calendar,
          navigation: {
            ...model.calendar.navigation,
            hiddenWeekdays: [weekday],
            mode,
          },
        },
      };

      const saved = preferenceSnapshot(base);
      expect(visibleDays(base.calendar.navigation)).not.toContain(day);

      const open = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const result = update(
        open,
        Message.KeyboardPick({ id: "go-to-selection" })
      );

      expect(result.model.calendar.navigation.mode).toBe("day");
      expect(visibleDays(result.model.calendar.navigation)).toEqual([day]);
      expect(preferenceSnapshot(result.model)).toEqual(saved);

      const ordinary = update(
        result.model,
        Message.ClickedPage({ direction: 1 })
      ).model;

      expect(ordinary.calendar.navigation.revealedDay).toBeUndefined();
      expect(preferenceSnapshot(ordinary).hiddenWeekdays).toEqual(
        saved.hiddenWeekdays
      );
    })
);

it.effect.prop(
  "occurrence entries queue the requested direction and select the returned instance exactly once through the real root",
  {
    direction: Schema.Literals(["next", "previous"]),
  },
  ({ direction }) =>
    Effect.sync(() => {
      const { model, event } = selectionCommandFixture();
      const { loading, task } = beginCommandOccurrence(model, direction);
      expect(task.request.direction).toBe(direction);
      expect(task.request.eventId).toBe(event.eventId);
      const neighbor = commandNeighbor(event, direction === "next" ? 1 : -1);

      const message = Message.ReceivedOccurrence({
        notice: OccurrenceNotice.cases.Ready.make({ event: neighbor, task }),
      });

      const result = update(loading, message);
      expect(result.model.calendar.selected).toEqual([eventKey(neighbor)]);
      expect(result.model.calendar.navigation.anchor).toBe(
        dayFromIso(direction === "next" ? "2026-10-20" : "2026-10-18")
      );
      expect(result.model.editing).toBe(model.editing);
      expect(
        visibleEvents(result.model).some(
          (entry) => entry.source.eventId === neighbor.eventId
        )
      ).toBe(true);
      expect(Option.isNone(result.model.selectionCommands.task)).toBe(true);
      expect(update(result.model, message).model).toBe(result.model);
      expect(update(result.model, message).commands ?? []).toHaveLength(0);
    })
);

it.effect.prop(
  "absent and failed occurrence reads preserve selection and cannot replay a late ready result",
  {
    direction: Schema.Literals(["next", "previous"]),
    failed: Schema.Boolean,
  },
  ({ direction, failed }) =>
    Effect.sync(() => {
      const { model, event } = selectionCommandFixture();
      const { loading, task } = beginCommandOccurrence(model, direction);

      const notice = failed
        ? OccurrenceNotice.cases.Failed.make({
            problem: OccurrenceProblem.cases.Transport.make({}),
            task,
          })
        : OccurrenceNotice.cases.Ready.make({ event: null, task });

      const result = update(loading, Message.ReceivedOccurrence({ notice }));
      expect(result.model.calendar.selected).toEqual(model.calendar.selected);
      expect(result.model.calendar.navigation).toBe(model.calendar.navigation);
      expect(result.model.error).toEqual(model.error);
      expect(Option.isNone(result.model.selectionCommands.task)).toBe(true);

      const late = update(
        result.model,
        Message.ReceivedOccurrence({
          notice: OccurrenceNotice.cases.Ready.make({
            event: commandNeighbor(event),
            task,
          }),
        })
      );

      expect(late.model).toBe(result.model);
      expect(late.commands ?? []).toHaveLength(0);
    })
);

it.effect.prop(
  "a changed person, selection or view rejects stale occurrence completion",
  {
    changed: Schema.Literals(["person", "selection", "navigation"]),
  },
  ({ changed }) =>
    Effect.sync(() => {
      const { model, event } = selectionCommandFixture();
      const { loading, task } = beginCommandOccurrence(model, "next");

      const stale = {
        ...loading,
        calendar: {
          ...loading.calendar,
          navigation:
            changed === "navigation"
              ? {
                  ...loading.calendar.navigation,
                  anchor: loading.calendar.navigation.anchor + 1,
                }
              : loading.calendar.navigation,
          selected: changed === "selection" ? [] : loading.calendar.selected,
        },
        person:
          changed === "person" ? Option.some("another-person") : loading.person,
      };

      const result = update(
        stale,
        Message.ReceivedOccurrence({
          notice: OccurrenceNotice.cases.Ready.make({
            event: commandNeighbor(event),
            task,
          }),
        })
      );

      expect(result.model).toBe(stale);
      expect(result.commands ?? []).toHaveLength(0);
    })
);

it.effect(
  "occurrence commands are absent for ordinary, missing and multiple selections while safe Google links use the approved label",
  () =>
    Effect.sync(() => {
      const { model, event } = selectionCommandFixture(false);

      for (const selected of [
        [],
        [eventKey(event)],
        [eventKey(event), "another-event"],
      ]) {
        const open = update(
          { ...model, calendar: { ...model.calendar, selected } },
          Message.KeyboardAction({ id: "commands" })
        ).model;

        expect(
          commandChoices(open).some(
            (row) =>
              row.id === "next-occurrence" || row.id === "previous-occurrence"
          )
        ).toBe(false);

        if (selected.length === 0) {
          expect(
            commandChoices(open).some((row) => row.id === "go-to-selection")
          ).toBe(false);
        }
      }

      const open = update(
        model,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      expect(
        commandChoices(open).find((row) => row.id === "open-in-provider")?.title
      ).toBe("Open in Google Calendar");
    })
);

it.effect(
  "a selected hidden weekend remains in Month with a transient reveal and unchanged preferences",
  () =>
    Effect.sync(() => {
      const { model, event } = selectionCommandFixture();
      const weekend = commandNeighbor(event, -1);

      const base = {
        ...model,
        calendar: {
          ...model.calendar,
          navigation: {
            ...model.calendar.navigation,
            hideWeekends: true,
            mode: "month",
          },
          reads: [
            {
              accountId: event.accountId,
              events: RemoteEvents.Success({
                data: { events: [weekend], versions: [] },
              }),
            },
          ],
          selected: [eventKey(weekend)],
        },
      } satisfies AppModel;

      const open = update(
        base,
        Message.KeyboardAction({ id: "commands" })
      ).model;

      const result = update(
        open,
        Message.KeyboardPick({ id: "go-to-selection" })
      );

      const day = dayFromIso("2026-10-18");
      expect(result.model.calendar.navigation.mode).toBe("month");
      expect(
        monthWeeks(result.model.calendar.navigation).flatMap((week) =>
          week.days.map((entry) => entry.day)
        )
      ).toContain(day);
      expect(preferenceSnapshot(result.model).hiddenWeekdays).toEqual(
        preferenceSnapshot(base).hiddenWeekdays
      );
      expect(
        result.commands?.some((command) => command.name === "ScrollToSelection")
      ).toBe(false);

      const ordinary = update(
        result.model,
        Message.ClickedPage({ direction: 1 })
      ).model;

      expect(ordinary.calendar.navigation.revealedDay).toBeUndefined();
      expect(ordinary.calendar.navigation.hideWeekends).toBe(true);
    })
);
