import {
  DesktopAction,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { DesktopNotice } from "../src/client/desktop/model.js";
import { agendaSnapshot } from "../src/client/desktop/snapshot.js";
import { RsvpIntent } from "../src/client/editing/rsvp-machine.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingPerson,
} from "./upcoming-fixture.js";

const event = {
  ...savedUpcomingEvent,
  attendees: [
    {
      email: "self@example.test",
      responseStatus: "needsAction" as const,
      self: true,
    },
  ],
  eventId: "series_20261021T090000Z",
  recurringEventId: "series",
};

const key = {
  accountId: event.accountId,
  calendarId: event.calendarId,
  eventId: event.eventId,
};

const requested = (
  response: typeof DesktopAction.cases.RespondToEvent.fields.response.Type
) =>
  Message.ReceivedDesktop({
    notice: DesktopNotice.cases.Action.make({
      action: DesktopAction.cases.RespondToEvent.make({ key, response }),
    }),
  });

const loaded = () => {
  const base = upcomingFixture();

  const ready = update(
    base,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: base.upcoming.request,
      result: { events: [event], versions: [] },
    })
  ).model;

  return update(
    ready,
    Message.ReceivedDesktop({
      notice: DesktopNotice.cases.Settings.make({
        settings: {
          issues: [],
          openAtLogin: false,
          preferences: defaultDesktopPreferences(),
          revision: 1,
        },
      }),
    })
  ).model;
};

it.effect.each(["accepted", "declined", "tentative"] as const)(
  "tray %s dispatches the existing person-scoped writer without changing selection",
  (response) =>
    Effect.gen(function* dispatchChoice() {
      const model = loaded();
      const result = update(model, requested(response));
      expect(result.model.calendar).toBe(model.calendar);
      expect(result.model.editing).toBe(model.editing);
      expect(result.commands?.map((command) => command.name)).toEqual([
        "DispatchEditing",
      ]);

      const args = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ command: EditingCommand, personId: Schema.String })
      )(result.commands?.[0]?.args);

      expect(args.personId).toBe(upcomingPerson);
      expect(args.command).toEqual(
        EditingCommand.cases.Rsvp.make({ event, notePolicy: "omit", response })
      );
    })
);

it.effect(
  "stale, unavailable, wrong-person and no-longer-participating tray targets never dispatch",
  () =>
    Effect.sync(() => {
      const model = loaded();

      const expired = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: { events: [], versions: [] },
        })
      ).model;

      const notSelf = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: {
            events: [
              { ...event, attendees: [{ email: "other@example.test" }] },
            ],
            versions: [],
          },
        })
      ).model;

      const status = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: {
            events: [{ ...event, eventType: "focusTime" }],
            versions: [],
          },
        })
      ).model;

      for (const candidate of [
        expired,
        notSelf,
        status,
        { ...model, person: Option.none() },
        { ...model, person: Option.some("another-person") },
      ]) {
        const result = update(candidate, requested("accepted"));
        expect(result.commands ?? []).toEqual([]);
        expect(Option.getOrUndefined(result.model.error)).toBe(
          "This event is no longer available for a response."
        );
      }
    })
);

it.effect(
  "an observed busy RSVP disables publication and refuses another tray write visibly",
  () =>
    Effect.sync(() => {
      const base = loaded();

      const model = {
        ...base,
        editing: {
          ...base.editing,
          rsvp: {
            ...base.editing.rsvp,
            saving: Option.some(
              RsvpIntent.make({
                event,
                id: 1,
                request: { ...key, response: "accepted", sendUpdates: "none" },
              })
            ),
          },
        },
      };

      expect(
        agendaSnapshot(model, defaultDesktopPreferences()).events[0]?.rsvp
          ?.enabled
      ).toBe(false);
      const result = update(model, requested("tentative"));
      expect(result.commands ?? []).toEqual([]);
      expect(Option.getOrUndefined(result.model.error)).toBe(
        "Wait for the current event change to finish before responding."
      );
    })
);
