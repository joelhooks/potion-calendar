import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Data, Effect, Option } from "effect";
import type { Runtime } from "foldkit";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { RemoteDesktop } from "../src/client/desktop/model.js";
import {
  desktopProofObserver,
  desktopProofState,
} from "../src/client/desktop/proof.js";
import {
  upcomingFixture,
  upcomingPerson,
  savedUpcomingEvent,
} from "./upcoming-fixture.js";

it.effect(
  "the opt-in observer projects state transitions without people, account ids, locations, descriptions or attendee emails",
  () =>
    Effect.sync(() => {
      const base = upcomingFixture();

      const { model } = update(
        base,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: base.upcoming.request,
          result: {
            events: [
              {
                ...savedUpcomingEvent,
                attendees: [{ email: "private-attendee@example.test" }],
                description: "private description",
                location: "private address",
                title: "Safe title",
              },
            ],
            versions: [],
          },
        })
      );

      const ready = {
        ...model,
        desktop: {
          ...model.desktop,
          availability: "available",
          settings: RemoteDesktop.Success({
            data: {
              issues: [],
              openAtLogin: false,
              preferences: defaultDesktopPreferences(),
              revision: 7,
            },
          }),
        },
      } satisfies typeof model;

      const sample = desktopProofState(ready, 123);
      expect(sample).toMatchObject({
        desktopRevision: 7,
        eventCount: 1,
        hasPerson: true,
        projectedCount: 1,
        queryPersonMatches: true,
        saveAcknowledged: false,
        timestamp: 123,
        upcomingPhase: "Success",
      });
      const json = JSON.stringify(sample);

      for (const secret of [
        upcomingPerson,
        "private-attendee@example.test",
        "private description",
        "private address",
        "accountId",
        "calendarId",
        "eventId",
      ]) {
        expect(json).not.toContain(secret);
      }

      expect(json).toContain("Safe title");
      const query = Option.getOrThrow(ready.upcoming.query);
      expect(
        desktopProofState(
          {
            ...ready,
            upcoming: {
              ...ready.upcoming,
              query: Option.some({ ...query, personId: "wrong-person" }),
            },
          },
          124
        )
      ).toMatchObject({
        eventCount: 1,
        projectedCount: 0,
        queryPersonMatches: false,
      });
    })
);

it.effect(
  "the opt-in runtime observer uses the pinned development callback and emits no full Model",
  () =>
    Effect.sync(() => {
      const samples: ReturnType<typeof desktopProofState>[] = [];

      const observer = desktopProofObserver((sample) => {
        samples.push(sample);
      });

      const context =
        Data.taggedEnum<Runtime.SlowContext<AppModel, AppMessage>>();

      if (observer === false) {
        throw new Error("Diagnostic configuration is missing");
      }

      expect(observer.show).toBe("Development");
      expect(observer.thresholdOverrides).toEqual({ Update: -1, View: -1 });
      observer.onSlow?.(
        context.View({
          durationMs: 0,
          message: Option.none(),
          model: upcomingFixture(),
          thresholdMs: -1,
        })
      );
      expect(samples).toHaveLength(1);
      expect(samples[0]).not.toHaveProperty("model");
      expect(samples[0]).not.toHaveProperty("session");
    })
);
