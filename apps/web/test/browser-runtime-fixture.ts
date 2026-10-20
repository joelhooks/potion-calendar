import { Effect, Layer, Stream } from "effect";

import { MonthRuntime } from "../src/client/month/runtime.js";
import { unusedClipboardLayer } from "./clipboard-unused-fixture.js";

const unexpectedMonthWork = Effect.die(
  "This seam must not invoke month lifecycle resources"
);

export const unusedBrowserLayers = Layer.merge(
  unusedClipboardLayer,
  Layer.succeed(
    MonthRuntime,
    MonthRuntime.of({
      acknowledge: () => unexpectedMonthWork,
      bind: () => unexpectedMonthWork,
      viewChanges: Stream.die("This seam must not observe month view state"),
    })
  )
);
