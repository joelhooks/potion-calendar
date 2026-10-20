import { Reminder } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Ref } from "effect";
import { FetchHttpClient } from "effect/http";

import {
  ref,
  response,
  timedEvent,
} from "../../../packages/calendar/test/fake-google.js";
import { CalendarEditingClient } from "../src/client/editing/calendar-client.js";
import { createDraft } from "../src/layout/editor-draft.js";
import {
  customReminders,
  draftEventFields,
} from "../src/layout/editor-fields.js";
import { editingRpcFixture, writeBody } from "./editing-rpc-fixture.js";

it.effect.each([false, true])(
  "the real create RPC preserves explicit date-only clearing and normalizes matching timed defaults: allDay=%s",
  (allDay) =>
    Effect.gen(function* reminderCreateBoundary() {
      const defaults = [Reminder.make({ method: "popup", minutes: 30 })];

      const initial = yield* createDraft({
        allDay,
        endDate: "2026-10-19",
        endTime: "10:00",
        ref,
        startDate: "2026-10-19",
        startTime: "09:00",
        timeZone: "America/Los_Angeles",
      });

      const draft = allDay ? initial : customReminders(initial, defaults);
      const fields = yield* draftEventFields(draft);

      const expected = allDay
        ? { overrides: [], useDefault: false }
        : { useDefault: true };

      const api = yield* editingRpcFixture([
        response(200, {
          accessRole: "owner",
          defaultReminders: defaults,
          id: ref.calendarId,
        }),
        response(
          200,
          timedEvent("0123456789abcdef", "Reminder proof", {
            end: fields.end,
            reminders: expected,
            start: fields.start,
          })
        ),
      ]);

      const saved = yield* CalendarEditingClient.use((client) =>
        client.createEvent({
          ...ref,
          event: fields,
          id: "0123456789abcdef",
          sendUpdates: "none",
        })
      ).pipe(
        Effect.provide(CalendarEditingClient.layer("notAvailable")),
        Effect.provideService(FetchHttpClient.Fetch, api.fetcher)
      );

      const writes = yield* Ref.get(api.fake.requests);

      expect(writes.map((request) => request.method)).toEqual(["GET", "POST"]);
      expect(writeBody(writes.at(-1)?.body).reminders).toEqual(expected);
      expect(saved.reminders).toEqual(expected);
      expect(api.requests).toHaveLength(1);
    })
);
