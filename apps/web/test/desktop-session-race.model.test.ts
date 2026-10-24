import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Result, Schema } from "effect";
import { AsyncData } from "foldkit";

import { initialModel, Message, update } from "../src/client/app.js";
import { DesktopNotice, DesktopOutcome } from "../src/client/desktop/model.js";
import { desktopDependencies } from "../src/client/desktop/subscription.js";
import {
  savedUpcomingEvent,
  upcomingCalendars,
  upcomingNow,
  upcomingPerson,
  upcomingSession,
} from "./upcoming-fixture.js";

const settings = {
  issues: [],
  openAtLogin: false,
  preferences: defaultDesktopPreferences(),
  revision: 8,
};

const ready = Message.ReceivedDesktop({
  notice: DesktopNotice.cases.Finished.make({
    outcome: DesktopOutcome.cases.Ready.make({
      error: Option.none(),
      settings,
    }),
    request: 0,
  }),
});

const signedIn = Message.ReceivedSession({ snapshot: upcomingSession });

it.effect.prop(
  "both native-settings and session arrival orders publish the same saved agenda",
  { settingsFirst: Arbitrary.schema(Schema.Boolean) },
  ({ settingsFirst }) =>
    Effect.sync(() => {
      let model = initialModel(upcomingNow, "UTC");

      for (const message of settingsFirst
        ? [ready, signedIn]
        : [signedIn, ready]) {
        ({ model } = update(model, message));
      }

      expect(AsyncData.getData(model.desktop.settings)).toEqual(
        Option.some(settings)
      );
      ({ model } = update(
        model,
        Message.ReceivedCalendars({
          personId: upcomingPerson,
          result: upcomingCalendars,
        })
      ));
      ({ model } = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: { events: [savedUpcomingEvent], versions: [] },
        })
      ));
      expect(
        Result.isSuccess(Result.try(() => desktopDependencies(model)))
      ).toBe(true);
      expect(desktopDependencies(model).snapshot.events).toHaveLength(1);
      expect(desktopDependencies(model).snapshot.events[0]?.title).toBe(
        savedUpcomingEvent.title
      );
    })
);

it.effect(
  "sign-out then another person retains only device settings and cannot republish the previous person's events",
  () =>
    Effect.sync(() => {
      let { model } = update(initialModel(upcomingNow, "UTC"), ready);
      ({ model } = update(model, signedIn));
      ({ model } = update(
        model,
        Message.ReceivedCalendars({
          personId: upcomingPerson,
          result: upcomingCalendars,
        })
      ));
      ({ model } = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: { events: [savedUpcomingEvent], versions: [] },
        })
      ));
      const oldRequest = model.upcoming.request;
      ({ model } = update(model, Message.ClickedSignOut()));
      expect(
        Result.isSuccess(Result.try(() => desktopDependencies(model)))
      ).toBe(true);
      expect(desktopDependencies(model).snapshot.events).toHaveLength(0);
      ({ model } = update(model, Message.ReceivedSession({ snapshot: null })));
      expect(AsyncData.getData(model.desktop.settings)).toEqual(
        Option.some(settings)
      );

      const other = {
        accounts: [
          { disconnected: false, email: "new@example.test", id: "new-work" },
        ],
        user: {
          email: "new@example.test",
          id: "new-person",
          name: "New person",
        },
      };

      ({ model } = update(model, Message.ReceivedSession({ snapshot: other })));
      expect(model.calendar.calendars).toHaveLength(0);
      expect(Option.isNone(model.upcoming.query)).toBe(true);
      ({ model } = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: oldRequest,
          result: { events: [savedUpcomingEvent], versions: [] },
        })
      ));
      expect(desktopDependencies(model).snapshot.events).toHaveLength(0);
      expect(AsyncData.getData(model.desktop.settings)).toEqual(
        Option.some(settings)
      );

      const inventory = {
        accounts: upcomingCalendars.accounts
          .filter((account) => account.accountId === "work")
          .map((account) => ({
            ...account,
            accountId: "new-work",
            calendars: account.calendars.map((calendar) => ({
              ...calendar,
              accountId: "new-work",
            })),
          })),
      };

      ({ model } = update(
        model,
        Message.ReceivedCalendars({
          personId: other.user.id,
          result: inventory,
        })
      ));

      const event = {
        ...savedUpcomingEvent,
        accountId: "new-work",
        eventId: "new-own-event",
        title: "New person's event",
      };

      ({ model } = update(
        model,
        Message.ReceivedUpcoming({
          personId: other.user.id,
          request: model.upcoming.request,
          result: { events: [event], versions: [] },
        })
      ));
      const publication = desktopDependencies(model).snapshot;
      expect(publication.events.map((item) => item.key.accountId)).toEqual([
        "new-work",
      ]);
      expect(publication.events.map((item) => item.title)).toEqual([
        event.title,
      ]);
    })
);

it.effect(
  "session reset preserves the native request fence but drops action errors",
  () =>
    Effect.sync(() => {
      const base = update(initialModel(upcomingNow, "UTC"), ready).model;

      const pending = {
        ...base,
        desktop: {
          ...base.desktop,
          error: Option.some("Old action failed"),
          request: 5,
        },
      };

      const reset = update(pending, signedIn).model;
      expect(reset.desktop.request).toBe(5);
      expect(Option.isNone(reset.desktop.error)).toBe(true);

      const stale = update(
        reset,
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Finished.make({
            outcome: DesktopOutcome.cases.Unavailable.make({}),
            request: 4,
          }),
        })
      ).model;

      expect(stale.desktop.availability).toBe("available");
      expect(AsyncData.getData(stale.desktop.settings)).toEqual(
        Option.some(settings)
      );
    })
);
