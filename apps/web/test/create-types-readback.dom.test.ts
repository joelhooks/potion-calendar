import { expect, it } from "@effect/vitest";
import { Effect, Ref, Result } from "effect";
import { FetchHttpClient } from "effect/http";

import {
  ref,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { editingRpcFixture } from "./editing-rpc-fixture.js";

it.effect.each([200, 409])(
  "a %s result with a different returned type is unconfirmed, not a silently saved Focus event",
  (status) =>
    Effect.gen(function* statusReadback() {
      const returned = response(
        200,
        timedEvent("0123456789abcdef", "Different type", {
          eventType: "default",
        })
      );

      const replies = [
        response(200, {
          accessRole: "owner",
          id: ref.calendarId,
          primary: true,
        }),
        ...(status === 409 ? [response(409), returned] : [returned]),
      ];

      const api = yield* editingRpcFixture(replies);

      const result = yield* CalendarEditingClient.use((client) =>
        client.createEvent({
          ...ref,
          event: {
            attendees: [],
            end: { dateTime: "2026-10-21T17:00:00Z" },
            eventType: "focusTime",
            focusTimeProperties: { autoDeclineMode: "declineNone" },
            start: { dateTime: "2026-10-21T16:00:00Z" },
            transparency: "opaque",
          },
          id: "0123456789abcdef",
          sendUpdates: "none",
        })
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher),
        Effect.result
      );

      expect(Result.isFailure(result)).toBe(true);
      expect(
        (yield* Ref.get(api.fake.receipts)).filter(
          (receipt) => receipt.request.method === "POST"
        )
      ).toHaveLength(1);
    })
);
