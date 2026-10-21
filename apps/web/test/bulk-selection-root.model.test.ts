import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { BulkExecution, BulkView } from "../src/client/bulk/model.js";
import { bulkPlanFor } from "../src/client/bulk/selection.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { EditorAction } from "../src/client/editing/editor-action.js";
import {
  EditingCommand,
  EditingNotice,
} from "../src/client/editing/runtime.js";
import { selectedEvent } from "../src/client/keyboard/registry.js";
import { monthInitialPosition } from "../src/client/month/host.js";
import { monthGeometry } from "../src/layout/month.js";
import { isoFromDay } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { primarySelection } from "../src/layout/selection-set.js";
import { bulkRootFixture } from "./bulk-root-fixture.js";

it.effect.prop(
  "root selection histories preserve one ordered set, toggle only the indicated key and derive the newest primary in week and month",
  {
    history: Schema.Array(
      Schema.Struct({
        index: Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 })),
        kind: Schema.Literals([
          "click",
          "shift",
          "mod",
          "x",
          "all",
          "clear",
          "foreign",
        ]),
      })
    ).check(Schema.isMaxLength(40)),
    month: Schema.Boolean,
  },
  ({ history, month }) =>
    Effect.sync(() => {
      const fixture = bulkRootFixture(month);
      const { model: startingModel } = fixture;
      let model: AppModel = startingModel;
      let expected: string[] = [];

      for (const item of history) {
        const key = fixture.keys[item.index];

        if (key === undefined) {
          throw new Error("Missing selected fixture key.");
        }

        switch (item.kind) {
          case "click": {
            ({ model } = update(model, Message.ClickedEvent({ key })));
            expected = [key];
            break;
          }

          case "shift":
          case "mod": {
            ({ model } = update(
              model,
              Message.ModifiedEventSelection({
                hostKey: fixture.hostKey,
                key,
                mod: item.kind === "mod",
                personId: fixture.personId,
                shift: item.kind === "shift",
              })
            ));
            expected = expected.includes(key)
              ? expected.filter((value) => value !== key)
              : [...expected, key];
            break;
          }

          case "x": {
            ({ model } = update(
              {
                ...model,
                keyboard: { ...model.keyboard, cursor: Option.some(key) },
              },
              Message.KeyboardAction({ id: "toggle-selection" })
            ));
            expected = expected.includes(key)
              ? expected.filter((value) => value !== key)
              : [...expected, key];
            break;
          }

          case "all": {
            ({ model } = update(
              model,
              Message.KeyboardAction({ id: "select-all" })
            ));
            expected = [...fixture.keys];
            break;
          }

          case "clear": {
            ({ model } = update(model, Message.ClosedDetail()));
            expected = [];
            break;
          }

          case "foreign": {
            ({ model } = update(
              model,
              Message.ModifiedEventSelection({
                hostKey: fixture.hostKey,
                key,
                mod: true,
                personId: "another-person",
                shift: false,
              })
            ));
            break;
          }

          default: {
            throw new Error("Unexpected history action.");
          }
        }

        expect(model.calendar.selected).toEqual(expected);
        expect(primarySelection(model.calendar.selected)).toEqual(
          Option.fromUndefinedOr(expected.at(-1))
        );
        expect(selectedEvent(model)?.key).toBe(expected.at(-1));
        expect(
          visibleEvents(model)
            .filter((event) => event.selected)
            .map((event) => event.key)
            .toSorted()
        ).toEqual([...expected].toSorted());
      }
    })
);

it.effect.prop(
  "month select-all follows the settled visible weeks rather than the stale label month or buffered cache",
  { weeks: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 1 })) },
  ({ weeks }) =>
    Effect.sync(() => {
      const fixture = bulkRootFixture(true);
      const position = monthInitialPosition(fixture.model);

      const { rowHeight } = monthGeometry(
        fixture.model.calendar.viewport,
        fixture.model.settings.showWeekNumbers
      );

      const first = position.firstWeek + (6 + weeks) * 7;
      const [source] = fixture.events;

      if (source === undefined) {
        throw new Error("Missing month source fixture.");
      }

      const events = [first - 1, first, first + 41, first + 42].map(
        (day, index) => ({
          ...source,
          end: { date: isoFromDay(day + 1) },
          eventId: `month-visible-${index}`,
          start: { date: isoFromDay(day) },
        })
      );

      const model: AppModel = {
        ...fixture.model,
        calendar: {
          ...fixture.model.calendar,
          reads: [
            {
              accountId: source.accountId,
              events: RemoteEvents.Success({ data: { events, versions: [] } }),
            },
          ],
        },
        month: {
          ...fixture.model.month,
          settled: Option.some({
            anchor: fixture.model.calendar.navigation.anchor,
            position: {
              firstWeek: position.firstWeek,
              scrollTop: (6 + weeks) * rowHeight,
            },
            session: { hostKey: fixture.hostKey, id: 1 },
          }),
        },
      };

      const selected = update(
        model,
        Message.KeyboardAction({ id: "select-all" })
      ).model;

      expect(selected.calendar.selected).toEqual(
        visibleEvents(model)
          .filter(
            (event) =>
              event.source.eventId === "month-visible-1" ||
              event.source.eventId === "month-visible-2"
          )
          .map((event) => event.key)
      );
    })
);

it.effect(
  "a foreign bulk completion cannot add deletion marks, change notices or start reads for the current person",
  () =>
    Effect.sync(() => {
      const fixture = bulkRootFixture();

      const execution = BulkExecution.make({
        id: "old-person-result",
        mutations: [],
        plan: bulkPlanFor(fixture.model, "duplicate"),
        receipts: [],
        selection: fixture.keys,
      });

      const result = update(
        fixture.model,
        Message.ReceivedEditing({
          notice: EditingNotice.cases.Bulk.make({
            view: BulkView.cases.Settled.make({ execution }),
          }),
          personId: "another-person",
        })
      );

      expect(result.model).toBe(fixture.model);
      expect(result.commands ?? []).toEqual([]);
    })
);

it.effect(
  "bulk root dispatches one group plan rather than opening the primary editor, preserves permission skips and never selects a series scope",
  () =>
    Effect.sync(() => {
      const fixture = bulkRootFixture();

      const model: AppModel = {
        ...fixture.model,
        calendar: { ...fixture.model.calendar, selected: fixture.keys },
      };

      const deletion = bulkPlanFor(model, "delete");

      expect(deletion.steps.map(({ request }) => request.event.title)).toEqual([
        "Alpha",
        "Beta",
      ]);
      expect(deletion.skipped.map(({ title }) => title)).toEqual(["Gamma"]);
      expect(deletion.steps.every(({ scope }) => scope === "single")).toBe(
        true
      );

      for (const action of [
        EditorAction.cases.DeleteSelected.make({}),
        EditorAction.cases.DuplicateSelected.make({}),
      ]) {
        const result = update(
          model,
          Message.EditingAction({ action, personId: fixture.personId })
        );

        expect(result.commands?.map((command) => command.name)).toEqual([
          "DispatchEditing",
        ]);

        const command = Option.getOrThrow(
          Schema.decodeUnknownOption(EditingCommand)(
            result.commands?.[0]?.args?.command
          )
        );

        expect(EditingCommand.guards.Bulk(command)).toBe(true);

        if (EditingCommand.guards.Bulk(command)) {
          expect(command.selection).toEqual(fixture.keys);
        }

        expect(result.model.editing.view).toBe(model.editing.view);
      }
    })
);

it.effect.each([false, true])(
  "stale selection hosts and old people cannot replace or preview the current week/month set (%s)",
  (month) =>
    Effect.sync(() => {
      const fixture = bulkRootFixture(month);

      const model = {
        ...fixture.model,
        calendar: { ...fixture.model.calendar, selected: fixture.keys },
      };

      for (const guard of [
        { hostKey: "retired-host", personId: fixture.personId },
        { hostKey: fixture.hostKey, personId: "previous-person" },
      ]) {
        expect(
          update(model, Message.SelectedRectangle({ ...guard, keys: [] })).model
        ).toBe(model);
        expect(
          update(
            model,
            Message.PreviewedSelectionRectangle({
              ...guard,
              box: Option.some({ height: 40, left: 0, top: 0, width: 40 }),
            })
          ).model
        ).toBe(model);
      }

      const replacement = update(
        model,
        Message.SelectedRectangle({
          hostKey: fixture.hostKey,
          keys: [fixture.keys[0] ?? "missing"],
          personId: fixture.personId,
        })
      ).model;

      expect(replacement.calendar.selected).toEqual([fixture.keys[0]]);
      expect(Option.isNone(replacement.calendar.rectangle)).toBe(true);
    })
);

it.effect(
  "queued modifier and rectangle results from the previous time period cannot undo navigation's selection clear",
  () =>
    Effect.sync(() => {
      const fixture = bulkRootFixture();

      const selected = {
        ...fixture.model,
        calendar: { ...fixture.model.calendar, selected: fixture.keys },
      };

      const next = update(
        selected,
        Message.ClickedPage({ direction: 1 })
      ).model;

      const modifier = update(
        next,
        Message.ModifiedEventSelection({
          hostKey: fixture.hostKey,
          key: fixture.keys[0] ?? "missing",
          mod: true,
          personId: fixture.personId,
          shift: false,
        })
      );

      const rectangle = update(
        next,
        Message.SelectedRectangle({
          hostKey: fixture.hostKey,
          keys: fixture.keys,
          personId: fixture.personId,
        })
      );

      expect(modifier.model).toBe(next);
      expect(rectangle.model).toBe(next);
      expect(next.calendar.selected).toEqual([]);
    })
);

it.effect(
  "navigation and sign-out clear all selected members without altering clipboard, conferencing or month preferences",
  () =>
    Effect.sync(() => {
      const fixture = bulkRootFixture();

      const model = {
        ...fixture.model,
        calendar: { ...fixture.model.calendar, selected: fixture.keys },
      };

      const moved = update(model, Message.ClickedPage({ direction: 1 })).model;

      expect(moved.calendar.selected).toEqual([]);
      expect(moved.clipboard).toBe(model.clipboard);
      expect(moved.conferencing).toBe(model.conferencing);
      expect(moved.settings).toBe(model.settings);

      const signedOut = update(
        model,
        Message.ReceivedSession({ snapshot: null })
      ).model;

      expect(signedOut.calendar.selected).toEqual([]);
      expect(signedOut.editing.bulk._tag).toBe("Idle");
    })
);
