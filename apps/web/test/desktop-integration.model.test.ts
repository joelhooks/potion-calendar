import {
  DesktopAction,
  MeetingJoinOutcome,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { AsyncData } from "foldkit";

import { Message, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { ApplyDesktopRequest } from "../src/client/desktop/commands.js";
import { DesktopNotice, DesktopRequest } from "../src/client/desktop/model.js";
import { desktopSelection } from "../src/client/desktop/selection.js";
import { JoinSelection } from "../src/client/meetings/model.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { SettingsRoute } from "../src/layout/route.js";
import { meetingModel, savedMeeting } from "./meetings-fixture.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingPerson,
} from "./upcoming-fixture.js";

const loaded = () => {
  const base = upcomingFixture();

  const saved = update(
    base,
    Message.ReceivedUpcoming({
      personId: upcomingPerson,
      request: base.upcoming.request,
      result: { events: [savedUpcomingEvent], versions: [] },
    })
  ).model;

  return update(
    saved,
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

it.effect(
  "the native global join intent uses the existing selected-first browser command",
  () =>
    Effect.sync(() => {
      const selectedEvent = savedMeeting(1, 60, 90, {
        conferenceUrl: undefined,
      });

      const seed = meetingModel([savedMeeting(0, 10, 30), selectedEvent]);

      const base = {
        ...seed,
        calendar: {
          ...seed.calendar,
          reads: [
            {
              accountId: "work",
              events: RemoteEvents.Success({
                data: { events: [selectedEvent], versions: [] },
              }),
            },
          ],
        },
      };

      const selected = visibleEvents(base).find(
        (event) => event.source.eventId === selectedEvent.eventId
      );

      if (selected === undefined) {
        throw new Error("Selected native meeting fixture is missing");
      }

      const { model } = update(
        base,
        Message.ClickedEvent({ key: selected.key })
      );

      const direct = update(
        model,
        Message.RequestedJoinMeeting({ key: Option.none() })
      );

      const native = update(
        model,
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Action.make({
            action: DesktopAction.cases.RequestedJoinMeeting.make({}),
          }),
        })
      );

      expect(native.commands?.[0]?.args).toEqual({
        personId: Option.getOrThrow(model.person),
        selection: JoinSelection.cases.Unavailable.make({
          outcome: MeetingJoinOutcome.cases.NoMeeting.make({
            reason: "noConferencing",
          }),
        }),
      });
      expect(
        native.commands?.map((command) => ({
          args: command.args,
          name: command.name,
        }))
      ).toEqual(
        direct.commands?.map((command) => ({
          args: command.args,
          name: command.name,
        }))
      );
    })
);

it.effect(
  "native Show event navigates to the saved date and uses the normal selected detail projection",
  () =>
    Effect.sync(() => {
      const model = loaded();
      const selected = desktopSelection(model, savedUpcomingEvent);

      const shown = update(
        { ...model, route: SettingsRoute.make({ page: "menu-bar" }) },
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Action.make({
            action: DesktopAction.cases.ShowEvent.make({
              key: savedUpcomingEvent,
            }),
          }),
        })
      ).model;

      expect(shown.route._tag).toBe("Calendar");
      expect(shown.calendar.selected).toEqual(
        Option.fromUndefinedOr(selected?.key)
      );
      expect(
        visibleEvents(shown).some(
          (event) =>
            event.selected &&
            event.source.eventId === savedUpcomingEvent.eventId
        )
      ).toBe(true);
    })
);

it.effect(
  "a native key from a cleared session cannot reopen the previous person's event",
  () =>
    Effect.sync(() => {
      const model = loaded();

      const shown = update(
        {
          ...model,
          calendar: { ...model.calendar, selected: Option.none() },
          person: Option.none(),
        },
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Action.make({
            action: DesktopAction.cases.ShowEvent.make({
              key: savedUpcomingEvent,
            }),
          }),
        })
      ).model;

      expect(shown.calendar.selected).toEqual(Option.none());
      expect(Option.isSome(shown.error)).toBe(true);
    })
);

it.effect(
  "native settings changes use a model-owned request id and retain observed OS state while pending",
  () =>
    Effect.sync(() => {
      const model = loaded();

      const result = update(
        model,
        Message.RequestedDesktop({
          request: DesktopRequest.cases.Startup.make({
            enabled: true,
            request: 999,
          }),
        })
      );

      expect(result.commands?.[0]?.args).toEqual(
        ApplyDesktopRequest({
          request: DesktopRequest.cases.Startup.make({
            enabled: true,
            request: 1,
          }),
        }).args
      );
      expect(
        AsyncData.getData(result.model.desktop.settings).pipe(
          Option.map((settings) => settings.openAtLogin)
        )
      ).toEqual(Option.some(false));
    })
);
