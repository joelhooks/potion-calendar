import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import type { Update } from "foldkit";
import { expectTypeOf } from "vitest";

import { Message } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { PrefetchSearchDate } from "../src/client/search/commands.js";
import { withUpcoming } from "../src/client/upcoming/update.js";
import {
  searchResultsFixture,
  unexpectedSearchClient,
} from "./search-fixture.js";

it("upcoming preserves a wider command requirement and still rejects a missing provider", () => {
  const model = searchResultsFixture();

  const input: Update.Return<
    AppModel,
    AppMessage,
    EditingRuntime | CalendarSearchClient
  > = {
    commands: [
      PrefetchSearchDate({
        personId: "fixture-person",
        prefetch: {
          calendar: { accountId: "work", calendarId: "primary" },
          day: 20_000,
          timeZone: "America/Los_Angeles",
        },
        revision: 0,
      }),
    ],
    model,
  };

  const wrapped = withUpcoming(model, input, Message.Navigated());
  expectTypeOf(wrapped).toEqualTypeOf<typeof input>();

  const required = Effect.forEach(
    wrapped.commands ?? [],
    (command) => command.effect,
    { discard: true }
  );

  expectTypeOf<Effect.Services<typeof required>>().toEqualTypeOf<
    EditingRuntime | CalendarSearchClient
  >();
  expectTypeOf(required).not.toExtend<Effect.Effect<void>>();

  const missingSearch = required.pipe(
    Effect.provideService(
      EditingRuntime,
      EditingRuntime.of({
        connect: () => Effect.succeed(Stream.empty),
        dispatch: () => Effect.void,
      })
    )
  );

  expectTypeOf<
    Effect.Services<typeof missingSearch>
  >().toEqualTypeOf<CalendarSearchClient>();
  expectTypeOf(missingSearch).not.toExtend<Effect.Effect<void>>();

  const provided = missingSearch.pipe(
    Effect.provideService(CalendarSearchClient, unexpectedSearchClient)
  );

  expectTypeOf(provided).toEqualTypeOf<Effect.Effect<void>>();
});
