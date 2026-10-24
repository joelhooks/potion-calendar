import { Effect, Layer, Stream } from "effect";

import { MonthRuntime } from "../src/client/month/runtime.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { unusedClipboardLayer } from "./clipboard-unused-fixture.js";

const unexpectedMonthWork = Effect.die(
  "This seam must not invoke month lifecycle resources"
);

export const unusedSearchLayer = Layer.succeed(
  SearchRuntime,
  SearchRuntime.of({
    dispatchPage: () => Effect.die("This seam must not dispatch search pages"),
    observe: () => Stream.die("This seam must not observe search"),
    observePages: () => Stream.die("This seam must not observe search pages"),
  })
);

export const unusedBrowserLayers = Layer.mergeAll(
  unusedClipboardLayer,
  unusedSearchLayer,
  Layer.succeed(
    MonthRuntime,
    MonthRuntime.of({
      acknowledge: () => unexpectedMonthWork,
      bind: () => unexpectedMonthWork,
      viewChanges: Stream.die("This seam must not observe month view state"),
    })
  )
);
