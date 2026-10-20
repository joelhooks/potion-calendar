import { Effect, Layer, Redacted, Ref } from "effect";

import { CalendarService } from "../src/calendar.js";
import { GoogleTokens } from "../src/google-tokens.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import type { CalendarValue } from "../src/model.js";
import { GoogleHttp, GoogleRetryPolicy } from "../src/transport.js";
import type { GoogleRequestValue, GoogleResponse } from "../src/transport.js";
import {
  fakeConferencingDefaults,
  fakeGoogleCrypto,
  response,
  timedEvent,
} from "./fake-google.js";

export const searchCalendar = (
  calendarId = "calendar",
  accessRole: CalendarValue["accessRole"] = "owner"
): CalendarValue => ({
  accessRole,
  accountId: "account",
  calendarId,
  primary: false,
  timeZone: "America/Los_Angeles",
  title: `Calendar ${calendarId}`,
});

export const searchInput = {
  calendars: [searchCalendar()],
  query: "needle",
  timeZone: "America/Los_Angeles",
  weekStartsOn: 1,
} as const;

export const searchFixture = Effect.fn("searchFixture")(function* searchFixture(
  respond: (url: URL, request: GoogleRequestValue) => GoogleResponse = () =>
    response(200, { items: [timedEvent("event", "Unrelated provider match")] })
) {
  const requests = yield* Ref.make<readonly GoogleRequestValue[]>([]);
  const active = yield* Ref.make({ active: 0, peak: 0 });

  const http = Layer.succeed(GoogleHttp, {
    execute: (request: GoogleRequestValue) =>
      Effect.acquireUseRelease(
        Effect.gen(function* acquire() {
          yield* Ref.update(requests, (previous) => [...previous, request]);
          yield* Ref.update(active, (previous) => ({
            active: previous.active + 1,
            peak: Math.max(previous.peak, previous.active + 1),
          }));
        }),
        () =>
          Effect.sync(() =>
            respond(new URL(`https://fake.test${request.path}`), request)
          ),
        () =>
          Ref.update(active, (previous) => ({
            ...previous,
            active: previous.active - 1,
          }))
      ),
  });

  const tokens = Layer.succeed(GoogleTokens, {
    accessToken: () => Effect.succeed(Redacted.make("fake-token")),
    accounts: () => Effect.succeed([]),
  });

  const base = Layer.mergeAll(
    fakeGoogleCrypto,
    fakeConferencingDefaults,
    http,
    tokens,
    memoryCalendarStore,
    Layer.succeed(GoogleRetryPolicy, { baseDelayMs: 0, retries: 0 })
  );

  const clientLayer = GoogleCalendarClient.layer.pipe(Layer.provideMerge(base));
  const layer = CalendarService.layer.pipe(Layer.provideMerge(clientLayer));

  return { active, clientLayer, layer, requests };
});
