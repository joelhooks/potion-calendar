import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { calendarKey } from "../src/client/calendar-state.js";
import {
  contextMeeting,
  meetingCandidates,
  nextJoinMeeting,
} from "../src/client/meetings/candidates.js";
import { UpcomingMeetingMinutes } from "../src/client/settings/model.js";
import {
  meetingEpoch,
  meetingInput,
  savedMeeting,
} from "./meetings-fixture.js";

it.effect("panel and join have distinct exact start/end boundaries", () =>
  Effect.sync(() => {
    const candidates = meetingCandidates(
      meetingInput([
        savedMeeting(1, 20, 30),
        savedMeeting(0, 0, 10),
        savedMeeting(2, -5, 5),
      ])
    );

    expect(contextMeeting(candidates, meetingEpoch - 1, 240)?.item.title).toBe(
      "Meeting 0"
    );
    expect(contextMeeting(candidates, meetingEpoch, 240)?.item.title).toBe(
      "Meeting 1"
    );
    expect(nextJoinMeeting(candidates, meetingEpoch, 240)?.item.title).toBe(
      "Meeting 0"
    );
    expect(
      nextJoinMeeting(candidates, meetingEpoch + 10 * 60_000, 240)?.item.title
    ).toBe("Meeting 1");
    expect(
      contextMeeting(candidates, meetingEpoch + 20 * 60_000, 240)
    ).toBeUndefined();
    expect(
      nextJoinMeeting(candidates, meetingEpoch + 20 * 60_000, 240)?.item.title
    ).toBe("Meeting 1");
    expect(
      nextJoinMeeting(candidates, meetingEpoch + 30 * 60_000, 240)
    ).toBeUndefined();
  })
);

it.effect("missing conferencing remains visible but cannot block joining", () =>
  Effect.sync(() => {
    const candidates = meetingCandidates(
      meetingInput([
        savedMeeting(0, 5, 30, { conferenceUrl: undefined }),
        savedMeeting(1, 40, 80),
      ])
    );

    expect(contextMeeting(candidates, meetingEpoch, 240)?.item.title).toBe(
      "Meeting 0"
    );
    expect(nextJoinMeeting(candidates, meetingEpoch, 240)?.item.title).toBe(
      "Meeting 1"
    );
    expect(nextJoinMeeting(candidates, meetingEpoch, 30)).toBeUndefined();
  })
);

it.effect("static saved eligibility precedes equivalent-copy preference", () =>
  Effect.sync(() => {
    const declined = savedMeeting(0, -3, 30, {
      attendees: [
        {
          email: "person@example.test",
          responseStatus: "declined",
          self: true,
        },
      ],
    });

    const acceptedCopy = savedMeeting(0, -3, 30, {
      accountId: "personal",
      attendees: [
        {
          email: "person@example.test",
          responseStatus: "tentative",
          self: true,
        },
      ],
      calendarId: "personal",
      eventId: "accepted-copy",
    });

    const candidates = meetingCandidates(
      meetingInput(
        [
          declined,
          acceptedCopy,
          savedMeeting(1, 1, 20, { attendees: [] }),
          savedMeeting(2, 1, 20, { status: "cancelled" }),
          savedMeeting(3, 1, 20, {
            end: { date: "2026-10-22" },
            start: { date: "2026-10-21" },
          }),
          savedMeeting(4, 1, 20, { calendarId: "team" }),
        ],
        { hidden: [calendarKey("work", "team")] }
      )
    );

    expect(candidates).toHaveLength(1);
    expect(
      nextJoinMeeting(candidates, meetingEpoch, 240)?.item.source.eventId
    ).toBe("accepted-copy");
    expect(contextMeeting(candidates, meetingEpoch, 240)).toBeUndefined();
    expect(
      nextJoinMeeting(
        meetingCandidates(meetingInput([declined])),
        meetingEpoch,
        240
      )
    ).toBeUndefined();
  })
);

it.effect(
  "conference discovery uses the existing recognizer and safe native links",
  () =>
    Effect.sync(() => {
      const candidates = meetingCandidates(
        meetingInput([
          savedMeeting(0, 10, 30, {
            conferenceUrl: "data:text/plain,not-conferencing",
            location: "Room https://zoom.us/j/12345",
          }),
          savedMeeting(1, 20, 40, {
            conferenceUrl: undefined,
            description: "https://ordinary.example.test/not-a-meeting",
          }),
          savedMeeting(2, 30, 50, {
            conferenceUrl: "https://custom.example.test/meeting",
          }),
        ])
      );

      expect(candidates.map((candidate) => candidate.conferenceUrl)).toEqual([
        "https://zoom.us/j/12345",
        undefined,
        "https://custom.example.test/meeting",
      ]);
    })
);

const Slot = Schema.Struct({
  conference: Schema.Boolean,
  declined: Schema.Boolean,
  duration: Schema.Int.check(Schema.isBetween({ maximum: 300, minimum: 1 })),
  participants: Schema.Boolean,
  start: Schema.Int.check(Schema.isBetween({ maximum: 11_000, minimum: -300 })),
});

it.effect.prop(
  "generated clocks choose latest running or earliest joinable future within the exact horizon",
  {
    clock: Schema.Int.check(Schema.isBetween({ maximum: 300, minimum: -300 })),
    horizon: UpcomingMeetingMinutes,
    slots: Schema.Array(Slot),
  },
  ({ clock, horizon, slots }) =>
    Effect.sync(() => {
      const input = slots.slice(0, 10).map((slot, index) => ({
        ...slot,
        index,
        start: slot.start + index / 1000,
      }));

      const events = input.map((slot) =>
        savedMeeting(slot.index, slot.start, slot.start + slot.duration, {
          attendees: slot.participants
            ? [
                {
                  email: "person@example.test",
                  responseStatus: slot.declined ? "declined" : "accepted",
                  self: true,
                },
              ]
            : [],
          conferenceUrl: slot.conference
            ? "https://meet.google.com/abc-defg-hij"
            : undefined,
        })
      );

      const candidates = meetingCandidates(meetingInput(events.toReversed()));

      const eligible = input.filter(
        (slot) => slot.participants && !slot.declined
      );

      const future = eligible
        .filter((slot) => slot.start > clock && slot.start <= clock + horizon)
        .toSorted((left, right) => left.start - right.start);

      const running = eligible
        .filter(
          (slot) =>
            slot.conference &&
            slot.start <= clock &&
            slot.start + slot.duration > clock
        )
        .toSorted((left, right) => right.start - left.start);

      const join = running[0] ?? future.find((slot) => slot.conference);
      const now = meetingEpoch + clock * 60_000;

      expect(
        contextMeeting(candidates, now, horizon)?.item.source.eventId
      ).toBe(
        future[0] === undefined ? undefined : `meeting-${future[0].index}`
      );
      expect(
        nextJoinMeeting(candidates, now, horizon)?.item.source.eventId
      ).toBe(join === undefined ? undefined : `meeting-${join.index}`);
    })
);
