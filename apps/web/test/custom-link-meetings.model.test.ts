import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { Message, RemoteSession, update } from "../src/client/app.js";
import {
  ConferencingSettingsChange as Change,
  CustomVideoWrite,
} from "../src/client/settings/conferencing/model.js";
import {
  confirmMeetingCatalog,
  customMeetingModel,
  customMeetingRoom,
  expectCustomMeetingProjection as expectProjection,
  openCustomMeeting as openMeeting,
} from "./custom-link-meetings-fixture.js";
import { upcomingSession } from "./upcoming-fixture.js";

it.effect.prop(
  "a catalog entry that somehow holds a non-HTTPS or credential-bearing URL is never projected",
  {
    token: Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 0 })),
  },
  ({ token }) =>
    Effect.sync(() => {
      for (const link of [
        `http://room.example.test/${token}`,
        `http://meet.google.com/${token}`,
        `javascript:alert(${token})`,
        `data:text/plain,${token}`,
        `file:///meeting-${token}`,
        `https://fixture-user:fixture-password@room.example.test/${token}`,
        `https://fixture-user@room.example.test/${token}`,
      ]) {
        const base = customMeetingModel("removed", link);

        const model = {
          ...base,
          conferencingSettings: {
            ...base.conferencingSettings,
            entries: [{ ...customMeetingRoom, link }],
          },
        };

        expectProjection(model);
      }
    })
);

it.effect(
  "a catalog from a mismatched session cannot supply a meeting link",
  () =>
    Effect.sync(() => {
      const base = customMeetingModel();

      const model = {
        ...base,
        session: RemoteSession.Success({
          data: {
            ...upcomingSession,
            user: { ...upcomingSession.user, id: "foreign-session-person" },
          },
        }),
      };

      expectProjection(model);
    })
);

it.effect.prop(
  "only the current person's confirmed catalog controls saved custom Join through catalog and session histories",
  {
    actions: Schema.Array(
      Schema.Literals([
        "remove",
        "restore",
        "edit",
        "foreign",
        "stale",
        "unconfirmed",
        "legacy",
        "switch",
      ])
    ).check(Schema.isMaxLength(6)),
  },
  ({ actions }) =>
    Effect.gen(function* catalogHistory() {
      let model = customMeetingModel();
      let recognized = true;
      let hasMeeting = true;

      for (const action of actions) {
        const personId = Option.getOrThrow(model.person);

        switch (action) {
          case "remove": {
            model = confirmMeetingCatalog(model, []);
            recognized = false;
            break;
          }

          case "restore": {
            model = confirmMeetingCatalog(model, [customMeetingRoom]);
            recognized = true;
            break;
          }

          case "edit": {
            model = confirmMeetingCatalog(model, [
              { ...customMeetingRoom, link: `${customMeetingRoom.link}/new` },
            ]);
            recognized = false;
            break;
          }

          case "foreign": {
            ({ model } = update(
              model,
              Message.ChangedConferencingSettings({
                change: Change.cases.Loaded.make({
                  catalog: { conflicts: [], entries: [customMeetingRoom] },
                  requestId: model.conferencingSettings.requestId,
                }),
                personId: "foreign-catalog-person",
              })
            ));
            break;
          }

          case "stale": {
            model = confirmMeetingCatalog(model, []);
            ({ model } = update(
              model,
              Message.ChangedConferencingSettings({
                change: Change.cases.Load.make({}),
                personId,
              })
            ));
            ({ model } = update(
              model,
              Message.ChangedConferencingSettings({
                change: Change.cases.Loaded.make({
                  catalog: { conflicts: [], entries: [customMeetingRoom] },
                  requestId: model.conferencingSettings.requestId - 1,
                }),
                personId,
              })
            ));
            recognized = false;
            break;
          }

          case "unconfirmed": {
            model = confirmMeetingCatalog(model, [customMeetingRoom]);
            ({ model } = update(
              model,
              Message.ChangedConferencingSettings({
                change: Change.cases.Remove.make({ id: customMeetingRoom.id }),
                personId,
              })
            ));
            ({ model } = update(
              model,
              Message.ChangedConferencingSettings({
                change: Change.cases.Unconfirmed.make({
                  message: "The catalog write has no acknowledgement",
                  requestId: model.conferencingSettings.requestId,
                  write: CustomVideoWrite.cases.Remove.make({
                    id: customMeetingRoom.id,
                  }),
                }),
                personId,
              })
            ));
            recognized = false;
            break;
          }

          case "legacy": {
            model = confirmMeetingCatalog(model, []);
            model = {
              ...model,
              conferencingSettings: {
                ...model.conferencingSettings,
                draft: {
                  id: Option.none(),
                  link: customMeetingRoom.link,
                  name: customMeetingRoom.name,
                },
                legacyEntries: [customMeetingRoom],
              },
            };
            recognized = false;
            break;
          }

          case "switch": {
            ({ model } = update(
              model,
              Message.ReceivedSession({
                snapshot: {
                  ...upcomingSession,
                  user: { ...upcomingSession.user, id: "next-session-person" },
                },
              })
            ));
            recognized = false;
            hasMeeting = false;
            break;
          }

          default: {
            throw new Error("Unexpected catalog history action");
          }
        }

        const expected =
          recognized && hasMeeting ? customMeetingRoom.link : undefined;

        expectProjection(model, expected);
        const opened = yield* openMeeting(model);
        expect(opened.opened).toEqual(expected === undefined ? [] : [expected]);
      }
    })
);
