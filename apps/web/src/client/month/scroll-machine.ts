import { setupEffect } from "@xstate/effect";
import { Option, Schema } from "effect";
import { types } from "xstate";

import {
  initialMonthPosition,
  MonthPosition,
  MonthRebase,
  monthWindowRange,
  rebaseMonth,
} from "../../layout/month-window.js";

export const MonthCoverage = Schema.Struct({
  end: Schema.Int,
  start: Schema.Int,
});

export const MonthCoverageRequest = Schema.Struct({
  id: Schema.Int,
  range: MonthCoverage,
});

export const MonthRebaseRequest = Schema.Struct({
  id: Schema.Int,
  pinnedWeek: Schema.Option(Schema.Int),
  position: MonthPosition,
  rows: Schema.Int,
});

export const MonthScrollPoint = Schema.Struct({
  ...MonthPosition.fields,
  focusedDay: Schema.Option(Schema.Int),
});

interface Context {
  readonly hostKey: string;
  readonly rowHeight: number;
  readonly position: typeof MonthPosition.Type;
  readonly pendingRebase: Option.Option<typeof MonthRebaseRequest.Type>;
  readonly covered: Option.Option<typeof MonthCoverage.Type>;
  readonly pendingRead: Option.Option<typeof MonthCoverageRequest.Type>;
  readonly request: Option.Option<typeof MonthCoverageRequest.Type>;
  readonly sequence: number;
}

const contains = (
  covered: typeof MonthCoverage.Type,
  range: typeof MonthCoverage.Type
): boolean => covered.start <= range.start && covered.end >= range.end;

const settle = (context: Context): Context => {
  const range = monthWindowRange(context.position.firstWeek);

  if (
    Option.exists(context.covered, (covered) => contains(covered, range)) ||
    Option.exists(context.pendingRead, (pending) =>
      contains(pending.range, range)
    )
  ) {
    return context;
  }

  const request = MonthCoverageRequest.make({
    id: context.sequence + 1,
    range,
  });

  return {
    ...context,
    pendingRead: Option.some(request),
    request: Option.some(request),
    sequence: request.id,
  };
};

const track = (context: Context, point: typeof MonthScrollPoint.Type) => {
  if (point.firstWeek !== context.position.firstWeek) {
    return {};
  }

  const position = MonthPosition.make({
    firstWeek: point.firstWeek,
    scrollTop: point.scrollTop,
  });

  const rebased = rebaseMonth(position, context.rowHeight);

  if (!MonthRebase.guards.Rebased(rebased)) {
    return {
      context: { ...context, pendingRebase: Option.none(), position },
      target: "tracking" as const,
    };
  }

  const range = monthWindowRange(rebased.position.firstWeek);

  const pinnedWeek = point.focusedDay.pipe(
    Option.filter((day) => day < range.start || day >= range.end),
    Option.map(
      (day) =>
        position.firstWeek + Math.floor((day - position.firstWeek) / 7) * 7
    )
  );

  const pendingRebase = MonthRebaseRequest.make({
    id: context.sequence + 1,
    pinnedWeek,
    position: rebased.position,
    rows: rebased.rows,
  });

  return {
    context: {
      ...context,
      pendingRebase: Option.some(pendingRebase),
      position,
      sequence: pendingRebase.id,
    },
    target: "rebasing" as const,
  };
};

const applied = (
  context: Context,
  event: typeof MonthPosition.Type & { readonly id: number },
  settled: boolean
) => {
  const pending = Option.getOrUndefined(context.pendingRebase);

  if (
    pending === undefined ||
    pending.id !== event.id ||
    pending.position.firstWeek !== event.firstWeek
  ) {
    return {};
  }

  const next = {
    ...context,
    pendingRebase: Option.none(),
    position: MonthPosition.make({
      firstWeek: event.firstWeek,
      scrollTop: event.scrollTop,
    }),
  };

  return {
    context: settled ? settle(next) : next,
    target: settled ? ("idle" as const) : ("tracking" as const),
  };
};

export const monthScrollMachine = setupEffect({
  schemas: {
    context: types<Context>(),
    events: {
      APPLIED: Schema.Struct({ ...MonthPosition.fields, id: Schema.Int }),
      COVERED: Schema.Struct({ id: Schema.Int }),
      FAILED: Schema.Struct({ id: Schema.Int }),
      SCROLL: MonthScrollPoint,
      SETTLED: Schema.Struct({}),
    },
    input: Schema.Struct({
      covered: Schema.Option(MonthCoverage),
      hostKey: Schema.String,
      position: Schema.optional(MonthPosition),
      rowHeight: Schema.Finite,
      visibleWeek: Schema.Int,
    }),
  },
}).createMachine({
  context: ({ input }) => ({
    covered: input.covered,
    hostKey: input.hostKey,
    pendingRead: Option.none(),
    pendingRebase: Option.none(),
    position:
      input.position ??
      initialMonthPosition(input.visibleWeek, input.rowHeight),
    request: Option.none(),
    rowHeight: input.rowHeight,
    sequence: 0,
  }),
  initial: "idle",
  on: {
    COVERED: ({ context, event }) =>
      Option.match(context.pendingRead, {
        onNone: () => ({}),
        onSome: (pending) =>
          pending.id === event.id
            ? {
                context: {
                  ...context,
                  covered: Option.some(pending.range),
                  pendingRead: Option.none(),
                },
              }
            : {},
      }),
    FAILED: ({ context, event }) =>
      Option.exists(context.pendingRead, (pending) => pending.id === event.id)
        ? { context: { ...context, pendingRead: Option.none() } }
        : {},
  },
  states: {
    idle: {
      on: {
        SCROLL: ({ context, event }) => track(context, event),
        SETTLED: ({ context }) => ({ context: settle(context) }),
      },
    },
    rebasing: {
      on: {
        APPLIED: ({ context, event }) => applied(context, event, false),
        SCROLL: ({ context, event }) => track(context, event),
        SETTLED: { target: "rebasingSettled" },
      },
    },
    rebasingSettled: {
      on: {
        APPLIED: ({ context, event }) => applied(context, event, true),
        SCROLL: ({ context, event }) => track(context, event),
      },
    },
    tracking: {
      on: {
        SCROLL: ({ context, event }) => track(context, event),
        SETTLED: ({ context }) => ({
          context: settle(context),
          target: "idle",
        }),
      },
    },
  },
});
