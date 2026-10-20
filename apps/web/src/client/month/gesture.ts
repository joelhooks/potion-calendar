import { Option, Result, Schema } from "effect";

import {
  GesturePoint,
  GestureStart,
  GestureTarget,
} from "../editing/gesture-model.js";

export const MonthGestureInput = Schema.Struct({
  edge: GestureStart.fields.edge,
  point: GesturePoint,
  selected: Schema.Boolean,
  target: Schema.Option(GestureTarget),
});

export class MonthGestureRefused extends Schema.TaggedError<MonthGestureRefused>()(
  "MonthGestureRefused",
  {
    reason: Schema.Literals([
      "UnselectedEvent",
      "ReadOnlyEvent",
      "ResizeRequiresHorizontalSpan",
      "EmptyResize",
    ]),
  }
) {}

export const monthGestureStart = (
  input: typeof MonthGestureInput.Type
): Result.Result<typeof GestureStart.Type, MonthGestureRefused> => {
  const target = Option.getOrUndefined(input.target);

  if (target === undefined && input.edge !== "body") {
    return Result.fail(new MonthGestureRefused({ reason: "EmptyResize" }));
  }

  if (target !== undefined) {
    if (!input.selected) {
      return Result.fail(
        new MonthGestureRefused({ reason: "UnselectedEvent" })
      );
    }

    if (!target.editable && !(input.edge === "body" && input.point.alt)) {
      return Result.fail(new MonthGestureRefused({ reason: "ReadOnlyEvent" }));
    }

    if (input.edge !== "body" && !target.allDay) {
      return Result.fail(
        new MonthGestureRefused({ reason: "ResizeRequiresHorizontalSpan" })
      );
    }
  }

  return Result.succeed(
    GestureStart.make({
      allDay: true,
      edge: input.edge,
      point: input.point,
      target: input.target,
    })
  );
};
