import { Effect, Option } from "effect";
import { AsyncData } from "foldkit";

import type { AppModel } from "../src/client/app.js";
import { Message, RemoteSession, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import type { MapsNavigator } from "../src/layout/location-maps.js";
import { fixtureEvents, fixtureIndex, fixtureSelection } from "./fixture.js";

export const mapsLocationText = "123 Main Street, San Francisco & café #4";

export const mapsPlatformScope = Effect.fn("MapsTest.platform")(
  function* emulateMapsPlatform(platform: MapsNavigator) {
    const legacy = Object.getOwnPropertyDescriptor(navigator, "platform");
    const modern = Object.getOwnPropertyDescriptor(navigator, "userAgentData");

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        Object.defineProperty(navigator, "platform", {
          configurable: true,
          value: platform.platform,
        });
        Object.defineProperty(navigator, "userAgentData", {
          configurable: true,
          value: platform.userAgentData,
        });
      }),
      () =>
        Effect.sync(() => {
          if (legacy === undefined) {
            Reflect.deleteProperty(navigator, "platform");
          } else {
            Object.defineProperty(navigator, "platform", legacy);
          }

          if (modern === undefined) {
            Reflect.deleteProperty(navigator, "userAgentData");
          } else {
            Object.defineProperty(navigator, "userAgentData", modern);
          }
        })
    );
  }
);

export const settleMapsSnapshot = (model: AppModel): AppModel => {
  let settled = update(
    model,
    Message.ReceivedCalendars({
      personId: Option.getOrThrow(model.person),
      result: fixtureIndex,
    })
  ).model;

  for (const read of settled.calendar.reads) {
    const previous = model.calendar.reads.find(
      (item) => item.accountId === read.accountId
    );

    const data =
      previous === undefined
        ? undefined
        : Option.getOrUndefined(AsyncData.getData(previous.events));

    settled = update(
      settled,
      Message.ReceivedEvents({
        accountId: read.accountId,
        request: settled.calendar.rangeRequest,
        result: data ?? { events: [], versions: [] },
      })
    ).model;
  }

  return settled;
};

export const mapsFixture = (): AppModel => {
  const base = fixtureSelection();
  const session = Option.getOrThrow(AsyncData.getData(base.session));

  if (session === null) {
    throw new Error("Missing fixture session");
  }

  const source = Option.getOrThrow(Option.fromUndefinedOr(fixtureEvents[0]));

  const event = {
    ...source,
    description:
      "Notes https://example.test/notes and mailto:team@example.test",
    location: mapsLocationText,
  };

  return {
    ...base,
    calendar: {
      ...base.calendar,
      reads: [
        {
          accountId: event.accountId,
          events: RemoteEvents.Success({
            data: { events: [event], versions: [] },
          }),
        },
      ],
    },
    session: RemoteSession.Success({
      data: {
        ...session,
        accounts: session.accounts.filter((account) => !account.disconnected),
      },
    }),
  };
};
