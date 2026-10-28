import type { CustomVideoLink } from "@calendar/calendar/conferencing";
import {
  defaultDesktopPreferences,
  MeetingJoinOutcome,
} from "@calendar/core/desktop-bridge";
import { expect } from "@effect/vitest";
import { Effect, Option } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { agendaSnapshot } from "../src/client/desktop/snapshot.js";
import { JoinMeeting } from "../src/client/meetings/commands.js";
import { JoinSelection } from "../src/client/meetings/model.js";
import { MeetingPort } from "../src/client/meetings/port.js";
import { joinSelection } from "../src/client/meetings/selection.js";
import { savedMeetings } from "../src/client/meetings/source.js";
import { ConferencingSettingsChange as Change } from "../src/client/settings/conferencing/model.js";
import { meetingModel, savedMeeting } from "./meetings-fixture.js";

export const customMeetingRoom = {
  id: "owned-meeting-room",
  link: "https://room.example.test/team's-room",
  name: "Owned meeting room",
};

export const confirmMeetingCatalog = (
  model: AppModel,
  entries: readonly (typeof CustomVideoLink.Type)[]
): AppModel => {
  const personId = Option.getOrThrow(model.person);

  const pending = update(
    model,
    Message.ChangedConferencingSettings({
      change: Change.cases.Load.make({}),
      personId,
    })
  ).model;

  return update(
    pending,
    Message.ChangedConferencingSettings({
      change: Change.cases.Loaded.make({
        catalog: { conflicts: [], entries },
        requestId: pending.conferencingSettings.requestId,
      }),
      personId,
    })
  ).model;
};

export const customMeetingModel = (
  scene: "owned" | "anchor" | "removed" | "foreign" = "owned",
  link = customMeetingRoom.link
): AppModel => {
  const base = meetingModel([
    savedMeeting(0, 5, 35, {
      conferenceUrl: undefined,
      description: scene === "anchor" ? `<a href="${link}">Room</a>` : link,
    }),
  ]);

  const model = confirmMeetingCatalog(
    base,
    scene === "removed" || scene === "foreign"
      ? []
      : [{ ...customMeetingRoom, link }]
  );

  return scene === "foreign"
    ? update(
        model,
        Message.ChangedConferencingSettings({
          change: Change.cases.Loaded.make({
            catalog: {
              conflicts: [],
              entries: [{ ...customMeetingRoom, link }],
            },
            requestId: model.conferencingSettings.requestId,
          }),
          personId: "foreign-catalog-owner",
        })
      ).model
    : model;
};

export const customMeetingPreferences = defaultDesktopPreferences();

export const customMeetingAgenda = (model: AppModel) =>
  agendaSnapshot(model, customMeetingPreferences);

const key = { accountId: "work", calendarId: "primary", eventId: "meeting-0" };

export const openCustomMeeting = Effect.fn("test.openCustomMeeting")(
  function* openCustomMeeting(model: AppModel) {
    const opened: string[] = [];
    const selection = joinSelection(model, key);

    const command = JoinMeeting({
      personId: Option.getOrThrow(model.person),
      selection,
    });

    const requested = update(
      model,
      Message.RequestedJoinMeeting({ key: Option.some(key) })
    );

    const finished = yield* command.effect.pipe(
      Effect.provideService(MeetingPort, {
        open: (request) =>
          Effect.sync(() => {
            opened.push(request.conferenceUrl);

            return MeetingJoinOutcome.cases.Requested.make({
              key: request.key,
            });
          }),
      })
    );

    return { command, finished, opened, requested, selection };
  }
);

export const expectCustomMeetingProjection = (
  model: AppModel,
  expected?: string
) => {
  const [candidate] = savedMeetings(model);
  expect(candidate?.conferenceUrl).toBe(expected);
  const selection = joinSelection(model, key);
  expect(JoinSelection.guards.Available(selection)).toBe(
    expected !== undefined
  );

  if (JoinSelection.guards.Available(selection)) {
    expect(selection.conferenceUrl).toBe(expected);
    expect(selection.key).toEqual(key);
  }

  expect(customMeetingAgenda(model).events[0]?.conferenceUrl ?? null).toBe(
    expected ?? null
  );
};
