import {
  AccountConferencingDefault,
  CalendarEvent,
} from "@calendar/calendar/contracts";
import { expect, layer } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";

import type { FakeConferenceOutcome } from "../../src/dev/calendar-google.js";
import { DevelopmentRuntime } from "../../src/dev/native-runtime.js";
import { settingsRpcFixture } from "./settings-rpc-fixture.js";

class MeetRpc extends Context.Service<
  MeetRpc,
  Effect.Success<typeof settingsRpcFixture>
>()("test/MeetRpc") {}

const meetLayer = (outcome: typeof FakeConferenceOutcome.Type) =>
  Layer.effect(MeetRpc, settingsRpcFixture).pipe(
    Layer.provide(
      DevelopmentRuntime.layer("http://127.0.0.1:5173", undefined, outcome)
    )
  );

const times = {
  end: { dateTime: "2026-10-20T11:00:00Z" },
  start: { dateTime: "2026-10-20T10:00:00Z" },
};

for (const outcome of ["success", "pending", "failure"] as const) {
  layer(meetLayer(outcome), { excludeTestServices: true })(
    `native Meet ${outcome}`,
    (it) => {
      it.effect(
        "manual Meet works with default None, reads back its typed state, and removal clears it; the explicit account default applies only to a new meeting",
        () =>
          Effect.gen(function* conferencingProof() {
            const fixture = yield* MeetRpc;
            const { accountId, calendarId } = fixture.target;
            expect(fixture.target.allowedConferenceSolutionTypes).toContain(
              "hangoutsMeet"
            );
            yield* fixture.success(
              "setAccountConferencingDefault",
              { accountId, value: "none" },
              AccountConferencingDefault
            );

            const manual = yield* fixture.success(
              "createEvent",
              {
                accountId,
                calendarId,
                conferencingRequest: { kind: "googleMeet" },
                event: { ...times, title: "Manual Meet" },
                id: "meetmanual",
              },
              CalendarEvent
            );

            const expected = {
              failure: "failed",
              pending: "pending",
              success: "ready",
            }[outcome];

            expect(manual.conferencingStatus).toBe(expected);

            if (outcome === "success") {
              expect(manual.conferenceUrl).toMatch(
                /^https:\/\/meet\.google\.com\/dev-/u
              );
            } else {
              expect(manual.conferenceUrl).toBeUndefined();
            }

            const readback = yield* fixture.success(
              "getEvent",
              { accountId, calendarId, eventId: manual.eventId },
              CalendarEvent
            );

            expect(readback.conferencingStatus).toBe(expected);
            expect(readback.conferenceUrl).toBe(manual.conferenceUrl);

            const cleared = yield* fixture.success(
              "updateEvent",
              {
                accountId,
                calendarId,
                changes: {},
                conferencingRequest: { kind: "none" },
                eventId: manual.eventId,
                scope: "single",
              },
              CalendarEvent
            );

            expect(cleared.conferenceUrl).toBeUndefined();
            expect(cleared.conferencingStatus).toBeUndefined();
            yield* fixture.success(
              "setAccountConferencingDefault",
              { accountId, value: "googleMeet" },
              AccountConferencingDefault
            );

            const automatic = yield* fixture.success(
              "createEvent",
              {
                accountId,
                calendarId,
                event: {
                  ...times,
                  attendees: [{ email: "guest@example.test" }],
                  title: "Automatic Meet",
                },
                id: "automeet",
              },
              CalendarEvent
            );

            expect(automatic.conferencingStatus).toBe(expected);

            const ordinary = yield* fixture.success(
              "createEvent",
              {
                accountId,
                calendarId,
                event: { ...times, title: "Existing event" },
                id: "plainmeet",
              },
              CalendarEvent
            );

            expect(ordinary.conferencingStatus).toBeUndefined();

            const invited = yield* fixture.success(
              "updateEvent",
              {
                accountId,
                calendarId,
                changes: { attendees: [{ email: "guest@example.test" }] },
                eventId: ordinary.eventId,
                scope: "single",
              },
              CalendarEvent
            );

            expect(invited.conferencingStatus).toBeUndefined();
            expect(invited.conferenceUrl).toBeUndefined();
          })
      );
    }
  );
}
