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

it.effect.each(["focusTime", "outOfOffice"] as const)(
  "a %s update rejects both property objects rather than silently accepting or dropping the wrong one",
  (type) =>
    Effect.gen(function* rejectBothStatusProperties() {
      const properties = { autoDeclineMode: "declineNone" };

      const source = timedEvent("status-event", "Status", {
        eventType: type,
        organizer: { self: true },
        ...(type === "focusTime"
          ? { focusTimeProperties: properties }
          : { outOfOfficeProperties: properties }),
      });

      const api = yield* editingRpcFixture([
        response(200, source),
        response(200, {
          accessRole: "owner",
          id: ref.calendarId,
          primary: true,
        }),
        response(200, source),
      ]);

      const result = yield* CalendarEditingClient.use((client) =>
        client.updateEvent({
          ...ref,
          changes: {
            focusTimeProperties: { autoDeclineMode: "declineNone" },
            outOfOfficeProperties: { autoDeclineMode: "declineNone" },
          },
          eventId: "status-event",
          scope: "single",
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
          (receipt) => receipt.request.method === "PATCH"
        )
      ).toHaveLength(0);
    })
);

it.effect(
  "a raw caller cannot rewrite an all-conflicting saved policy through a supported checkbox value",
  () =>
    Effect.gen(function* rejectUnsupportedSavedPolicy() {
      const source = timedEvent("status-event", "Status", {
        eventType: "focusTime",
        focusTimeProperties: {
          autoDeclineMode: "declineAllConflictingInvitations",
        },
        organizer: { self: true },
      });

      const api = yield* editingRpcFixture([
        response(200, source),
        response(200, {
          accessRole: "owner",
          id: ref.calendarId,
          primary: true,
        }),
        response(200, source),
      ]);

      const result = yield* CalendarEditingClient.use((client) =>
        client.updateEvent({
          ...ref,
          changes: { focusTimeProperties: { autoDeclineMode: "declineNone" } },
          eventId: "status-event",
          scope: "single",
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
          (receipt) => receipt.request.method === "PATCH"
        )
      ).toHaveLength(0);
    })
);
