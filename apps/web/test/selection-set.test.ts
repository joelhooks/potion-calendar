import { expect, it } from "@effect/vitest";
import { Effect, Match, Option, Schema } from "effect";

import {
  SelectionAction,
  SelectionSet,
  changeSelection,
  primarySelection,
  rectangleSelection,
  selectionContext,
} from "../src/layout/selection-set.js";

const Key = Schema.Literals(["a", "b", "c", "d"]);

const HistoryAction = Schema.Struct({
  key: Key,
  kind: Schema.Literals([
    "click",
    "shift",
    "mod",
    "toggle",
    "add",
    "all",
    "clear",
  ]),
});

it.effect.prop(
  "selection histories keep unique ordered keys and derive the most recently added primary",
  { history: Schema.Array(HistoryAction).check(Schema.isMaxLength(60)) },
  ({ history }) =>
    Effect.sync(() => {
      let actual: typeof SelectionSet.Type = [];
      let expected: string[] = [];

      for (const { key, kind } of history) {
        const action = Match.value(kind).pipe(
          Match.when("clear", () => SelectionAction.cases.Clear.make({})),
          Match.when("all", () =>
            SelectionAction.cases.SelectAll.make({
              visible: ["b", "a", "b", "c"],
            })
          ),
          Match.when("add", () => SelectionAction.cases.Add.make({ key })),
          Match.when("toggle", () =>
            SelectionAction.cases.Toggle.make({ key })
          ),
          Match.orElse(() =>
            SelectionAction.cases.Click.make({
              key,
              mod: kind === "mod",
              shift: kind === "shift",
            })
          )
        );

        if (kind === "clear") {
          expected = [];
        } else if (kind === "all") {
          expected = ["b", "a", "c"];
        } else if (kind === "click") {
          expected = [key];
        } else if (kind === "add") {
          if (!expected.includes(key)) {
            expected.push(key);
          }
        } else if (expected.includes(key)) {
          expected = expected.filter((item) => item !== key);
        } else {
          expected.push(key);
        }

        const before = [...actual];
        const next = changeSelection(actual, action);

        expect(actual).toEqual(before);
        actual = next;
        expect(actual).toEqual(expected);
        expect(Schema.is(SelectionSet)(actual)).toBe(true);
        expect(primarySelection(actual)).toEqual(
          Option.fromUndefinedOr(expected.at(-1))
        );
        expect(selectionContext(actual)).toEqual({
          bulkOnly: expected.length > 1,
          label:
            expected.length > 1 ? `${expected.length} events selected` : "",
          primary: Option.fromUndefinedOr(expected.at(-1)),
        });
      }
    })
);

const Pixel = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(-10),
  Schema.isLessThanOrEqualTo(15)
);

const Size = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(15)
);

const Fragment = Schema.Struct({
  box: Schema.Struct({ height: Size, left: Pixel, top: Pixel, width: Size }),
  key: Key,
});

it.effect.prop(
  "rectangle replacement hits any visible shared area, clips all-day and multi-day fragments and is direction independent",
  {
    fragments: Schema.Array(Fragment).check(Schema.isMaxLength(15)),
    x1: Pixel,
    x2: Pixel,
    y1: Pixel,
    y2: Pixel,
  },
  ({ fragments, x1, x2, y1, y2 }) =>
    Effect.sync(() => {
      const viewport = { height: 10, left: 0, top: 0, width: 10 };
      const expected = new Set<string>();

      for (const { box, key } of fragments) {
        for (let x = 0; x < 10; x += 1) {
          for (let y = 0; y < 10; y += 1) {
            const inEvent =
              x >= box.left &&
              x < box.left + box.width &&
              y >= box.top &&
              y < box.top + box.height;

            const inRectangle =
              x >= Math.min(x1, x2) &&
              x < Math.max(x1, x2) &&
              y >= Math.min(y1, y2) &&
              y < Math.max(y1, y2);

            if (inEvent && inRectangle) {
              expected.add(key);
            }
          }
        }
      }

      const selected = rectangleSelection(
        fragments,
        { x: x1, y: y1 },
        { x: x2, y: y2 },
        viewport
      );

      expect(selected).toEqual([...expected]);
      expect(
        rectangleSelection(
          fragments,
          { x: x2, y: y2 },
          { x: x1, y: y1 },
          viewport
        )
      ).toEqual(selected);
      expect(primarySelection(selected)).toEqual(
        Option.fromUndefinedOr([...expected].at(-1))
      );
    })
);

it.effect(
  "fragments of one event select once, edge contact is not overlap, and a zero-area drag clears rather than retaining old selection",
  () =>
    Effect.sync(() => {
      const viewport = { height: 100, left: 0, top: 0, width: 100 };

      const fragments = [
        { box: { height: 10, left: -40, top: 5, width: 50 }, key: "all-day" },
        { box: { height: 10, left: 30, top: 5, width: 80 }, key: "multi-day" },
        { box: { height: 10, left: 60, top: 5, width: 10 }, key: "multi-day" },
        { box: { height: 10, left: 101, top: 5, width: 20 }, key: "outside" },
      ];

      expect(
        rectangleSelection(
          fragments,
          { x: 5, y: 10 },
          { x: 105, y: 20 },
          viewport
        )
      ).toEqual(["all-day", "multi-day"]);
      expect(
        rectangleSelection(
          fragments,
          { x: 10, y: 0 },
          { x: 30, y: 5 },
          viewport
        )
      ).toEqual([]);
      expect(
        rectangleSelection(
          fragments,
          { x: 0, y: 0 },
          { x: 0, y: 100 },
          viewport
        )
      ).toEqual([]);
    })
);
