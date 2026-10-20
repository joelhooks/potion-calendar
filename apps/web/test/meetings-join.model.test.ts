import { MeetingJoinOutcome } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { commandChoices } from "../src/client/keyboard/choices.js";
import { resolveBinding } from "../src/client/keyboard/input.js";
import { keyboardRegistry } from "../src/client/keyboard/registry.js";
import { JoinMeeting } from "../src/client/meetings/commands.js";
import { JoinSelection } from "../src/client/meetings/model.js";
import { MeetingPort } from "../src/client/meetings/port.js";
import { joinSelection } from "../src/client/meetings/selection.js";
import { UpcomingMeetingMinutes } from "../src/client/settings/model.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { meetingModel, savedMeeting } from "./meetings-fixture.js";

it.effect.prop(
  "a selected event exclusively controls joining regardless of its horizon, participants or response",
  {
    conference: Schema.Boolean,
    minutes: UpcomingMeetingMinutes,
    participants: Schema.Boolean,
    start: Schema.Int.check(
      Schema.isBetween({ maximum: 30_000, minimum: 15_000 })
    ),
  },
  ({ conference, minutes, participants, start }) =>
    Effect.gen(function* selectedOnly() {
      const selectedEvent = savedMeeting(7, start, start + 30, {
        attendees: participants
          ? [
              {
                email: "self@example.test",
                responseStatus: "declined",
                self: true,
              },
            ]
          : [],
        conferenceUrl: conference
          ? "https://meet.google.com/selected-event"
          : undefined,
      });

      const base = meetingModel([
        savedMeeting(0, -5, 30),
        savedMeeting(1, 30, 60),
      ]);

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          hideDeclined: false,
          reads: [
            {
              accountId: "work",
              events: RemoteEvents.Success({
                data: { events: [selectedEvent], versions: [] },
              }),
            },
          ],
        },
        settings: { ...base.settings, upcomingMeetingMinutes: minutes },
      };

      const item = visibleEvents(model).find(
        (event) => event.source.eventId === selectedEvent.eventId
      );

      if (item === undefined) {
        throw new Error("Missing selected meeting fixture");
      }

      const selected = update(
        model,
        Message.ClickedEvent({ key: item.key })
      ).model;

      const result = update(
        selected,
        Message.RequestedJoinMeeting({ key: Option.none() })
      );

      const selection = joinSelection(selected);
      const opened: string[] = [];

      const command = JoinMeeting({
        personId: Option.getOrThrow(selected.person),
        selection,
      });

      expect(
        result.commands?.find((entry) => entry.name === "JoinMeeting")?.args
      ).toEqual(command.args);

      const finished = yield* command.effect.pipe(
        Effect.provideService(MeetingPort, {
          open: (request) =>
            Effect.sync(() => {
              opened.push(request.key.eventId);

              return MeetingJoinOutcome.cases.Requested.make({
                key: request.key,
              });
            }),
        })
      );

      const applied = update(result.model, finished).model;

      expect(opened).toEqual(conference ? [selectedEvent.eventId] : []);
      expect(Option.getOrUndefined(applied.error)).toBe(
        conference ? undefined : "Selected event has no conferencing"
      );
      expect(applied.calendar.selected).toEqual(selected.calendar.selected);
    })
);

it.effect(
  "panel target joins the displayed future meeting rather than the ongoing fallback",
  () =>
    Effect.sync(() => {
      const model = meetingModel([
        savedMeeting(0, -5, 30),
        savedMeeting(1, 30, 60),
      ]);

      const requested = update(
        model,
        Message.RequestedJoinMeeting({
          key: Option.some({
            accountId: "work",
            calendarId: "primary",
            eventId: "meeting-1",
          }),
        })
      );

      expect(joinSelection(model)).toMatchObject({
        key: { eventId: "meeting-0" },
      });
      expect(
        requested.commands?.find((entry) => entry.name === "JoinMeeting")?.args
      ).toMatchObject({
        selection: { key: { eventId: "meeting-1" } },
      });
      expect(requested.model.calendar.navigation).toBe(
        model.calendar.navigation
      );
      expect(requested.model.calendar.selected).toBe(model.calendar.selected);
    })
);

it.effect(
  "a removed explicit target never falls through to a different meeting",
  () =>
    Effect.sync(() => {
      const model = meetingModel([savedMeeting(0, -5, 30)]);

      expect(
        joinSelection(model, {
          accountId: "work",
          calendarId: "primary",
          eventId: "removed",
        })
      ).toEqual(
        JoinSelection.cases.Unavailable.make({
          outcome: MeetingJoinOutcome.cases.Failed.make({
            message: "This meeting is no longer available.",
          }),
        })
      );
    })
);

it.effect(
  "Mod-J remains executable without a target while its command-menu row is omitted",
  () =>
    Effect.gen(function* noUpcoming() {
      const model = meetingModel([]);

      const binding = resolveBinding(
        model,
        { alt: false, key: "j", mod: true, shift: false },
        model.calendar.now,
        "grid"
      );

      const action = keyboardRegistry.find((entry) => entry.id === "join");

      expect(binding.action?.id).toBe("join");
      expect(action?.availability(model)).toBe("shortcut-only");
      expect(action?.keys).toContain("Mod+j");
      expect(
        commandChoices({
          ...model,
          keyboard: { ...model.keyboard, query: "join" },
        }).some((entry) => entry.id === "join")
      ).toBe(false);

      const invoked = update(
        model,
        Message.PressedCalendarKey({
          alt: false,
          key: "j",
          mod: true,
          shift: false,
        })
      );

      const selection = joinSelection(model);

      expect(
        invoked.commands?.find((entry) => entry.name === "JoinMeeting")?.args
      ).toMatchObject({ selection });

      const finished = yield* JoinMeeting({
        personId: Option.getOrThrow(model.person),
        selection,
      }).effect.pipe(
        Effect.provideService(MeetingPort, {
          open: () => Effect.die("An empty slice must not open a link"),
        })
      );

      expect(
        Option.getOrUndefined(update(invoked.model, finished).model.error)
      ).toBe("No upcoming meeting to join");
    })
);

it.effect(
  "a real target enables the Join meeting menu row and its shared request",
  () =>
    Effect.sync(() => {
      const model = meetingModel([savedMeeting(0, 1, 30)]);

      const choice = commandChoices({
        ...model,
        keyboard: { ...model.keyboard, query: "join" },
      }).find((entry) => entry.id === "join");

      expect(choice).toMatchObject({
        disabled: false,
        message: Message.RequestedJoinMeeting({ key: Option.none() }),
        title: "Join meeting",
      });
    })
);

it.effect(
  "old-person handoff outcomes do not change the current person's feedback",
  () =>
    Effect.sync(() => {
      const model = meetingModel([]);

      const outcome = MeetingJoinOutcome.cases.Failed.make({
        message: "Old person's failure",
      });

      const result = update(
        model,
        Message.FinishedJoinMeeting({ outcome, personId: "old-person" })
      );

      expect(result.model).toBe(model);
      expect(result.commands).toBeUndefined();
      expect(
        update(
          { ...model, person: Option.none() },
          Message.RequestedJoinMeeting({ key: Option.none() })
        ).commands
      ).toBeUndefined();
    })
);
