import type { EventFieldsValue } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Ref, Result, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import {
  ref,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { editingRpcFixture } from "./editing-rpc-fixture.js";

it.effect.prop(
  "status inserts reject guests, invitation updates, implicit invitation behavior and unpicked Chat fields at the server boundary",
  {
    chat: Schema.Boolean,
    decline: Schema.Boolean,
    guests: Schema.Boolean,
    implicit: Schema.Boolean,
    updates: Schema.Boolean,
  },
  ({ guests, updates, implicit, chat, decline }) =>
    Effect.gen(function* statusWritePolicy() {
      const permitted = !guests && !updates && !implicit && !chat && !decline;

      const declineMode = decline
        ? "declineAllConflictingInvitations"
        : "declineNone";

      const event: EventFieldsValue = {
        attendees: guests
          ? [{ email: "guest@example.test", responseStatus: "needsAction" }]
          : [],
        end: { dateTime: "2026-10-21T17:00:00Z" },
        eventType: "focusTime",
        focusTimeProperties: {
          autoDeclineMode: implicit ? undefined : declineMode,
          chatStatus: chat ? "doNotDisturb" : undefined,
        },
        start: { dateTime: "2026-10-21T16:00:00Z" },
        transparency: "opaque",
      };

      const api = yield* editingRpcFixture([
        response(200, {
          accessRole: "owner",
          id: ref.calendarId,
          primary: true,
        }),
        ...(permitted
          ? [
              response(
                200,
                timedEvent("0123456789abcdef", "Focus", {
                  eventType: "focusTime",
                })
              ),
            ]
          : []),
      ]);

      const result = yield* CalendarEditingClient.use((client) =>
        client.createEvent({
          ...ref,
          event,
          id: "0123456789abcdef",
          sendUpdates: updates ? "all" : "none",
        })
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher),
        Effect.result
      );

      expect(Result.isSuccess(result)).toBe(permitted);
      expect(
        (yield* Ref.get(api.fake.receipts)).filter(
          (receipt) => receipt.request.method === "POST"
        )
      ).toHaveLength(permitted ? 1 : 0);
    })
);
