import { expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { FetchHttpClient } from "effect/http";

import {
  ref,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";

it.effect(
  "an All-events time edit targets the selected instance but preserves the master's earlier date through real RPC",
  () =>
    Effect.gen(function* wholeSeriesClock() {
      const selected = timedEvent("instance", "Weekly meeting", {
        originalStartTime: { dateTime: "2026-03-15T09:00:00-07:00" },
        recurringEventId: "series",
      });

      const master = timedEvent("series", "Weekly meeting", {
        end: {
          dateTime: "2026-03-01T10:00:00-08:00",
          timeZone: "America/Los_Angeles",
        },
        recurrence: ["RRULE:FREQ=WEEKLY"],
        start: {
          dateTime: "2026-03-01T09:00:00-08:00",
          timeZone: "America/Los_Angeles",
        },
      });

      const api = yield* editingRpcFixture([
        response(200, selected),
        response(200, master),
        response(200, master),
      ]);

      yield* CalendarEditingClient.use((client) =>
        client.updateEvent({
          ...ref,
          changes: {
            end: {
              dateTime: "2026-03-15T12:00:00-07:00",
              timeZone: "America/Los_Angeles",
            },
            start: {
              dateTime: "2026-03-15T11:00:00-07:00",
              timeZone: "America/Los_Angeles",
            },
          },
          eventId: "instance",
          scope: "all",
          sendUpdates: "none",
        })
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher)
      );
      const requests = yield* Ref.get(api.fake.requests);
      const patch = requests.find((request) => request.method === "PATCH");
      expect(patch?.path).toContain("/events/series?");
      expect(writeBody(patch?.body)).toMatchObject({
        end: {
          dateTime: "2026-03-01T20:00:00.000Z",
          timeZone: "America/Los_Angeles",
        },
        start: {
          dateTime: "2026-03-01T19:00:00.000Z",
          timeZone: "America/Los_Angeles",
        },
      });
      expect(requests).toHaveLength(3);
    })
);
