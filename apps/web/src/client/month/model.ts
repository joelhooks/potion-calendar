import { Option, Schema } from "effect";

import { MonthPosition, MonthWindowFrame } from "../../layout/month-window.js";
import { MonthCoverage, MonthCoverageRequest } from "./scroll-machine.js";

export const MonthSession = Schema.Struct({
  hostKey: Schema.String,
  id: Schema.Int,
});

export const MonthNotice = Schema.TaggedUnion({
  Frame: { frame: MonthWindowFrame, session: MonthSession },
  Read: { request: MonthCoverageRequest, session: MonthSession },
  Settled: {
    anchor: Schema.Int,
    position: Schema.optional(MonthPosition),
    session: MonthSession,
  },
});

export const MonthReadBinding = Schema.Struct({
  request: MonthCoverageRequest,
  session: MonthSession,
});

export const MonthUi = Schema.Struct({
  epoch: Schema.Int,
  frame: Schema.Option(
    Schema.Struct({ frame: MonthWindowFrame, session: MonthSession })
  ),
  pending: Schema.Option(MonthReadBinding),
  range: Schema.Option(MonthCoverage),
  rangeHost: Schema.Option(Schema.String),
  settled: Schema.Option(
    Schema.Struct({
      anchor: Schema.Int,
      position: Schema.optional(MonthPosition),
      session: MonthSession,
    })
  ),
});

export const initialMonthUi = () =>
  MonthUi.make({
    epoch: 0,
    frame: Option.none(),
    pending: Option.none(),
    range: Option.none(),
    rangeHost: Option.none(),
    settled: Option.none(),
  });
