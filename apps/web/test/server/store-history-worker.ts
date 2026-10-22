import type { D1Database } from "@cloudflare/workers-types";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { TestClock } from "effect/testing";

import {
  runStoreHistory,
  StoreHistoryInput,
  StoreObservationsJson,
} from "../../../../packages/calendar/test/store-history.js";
import { d1CalendarStore } from "../../src/server/calendar-store.js";

export default {
  // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare owns the Promise-returning fetch boundary; HttpRouter owns Effects and finally awaits disposal.
  async fetch(request: Request, bindings: { readonly DB: D1Database }) {
    const route = HttpRouter.add(
      "POST",
      "/__store-contract-history",
      Effect.gen(function* executeNativeHistory() {
        const { commands, clockMilliseconds } =
          yield* HttpServerRequest.schemaBodyJson(StoreHistoryInput);

        yield* TestClock.setTime(clockMilliseconds);
        yield* Effect.promise(
          bindings.DB.batch.bind(bindings.DB, [
            bindings.DB.prepare("DELETE FROM calendar_range"),
            bindings.DB.prepare("DELETE FROM calendar_snapshot"),
          ])
        );

        const observations = yield* runStoreHistory(commands, () =>
          d1CalendarStore(bindings.DB, "person")
        );

        const body = yield* Schema.encodeEffect(StoreObservationsJson)(
          observations
        );

        return HttpServerResponse.text(body, {
          contentType: "application/json",
        });
      }).pipe(Effect.provide(TestClock.layer()))
    );

    const handler = HttpRouter.toWebHandler(route, { disableLogger: true });

    try {
      return await handler.handler(request);
    } finally {
      await handler.dispose();
    }
  },
};
