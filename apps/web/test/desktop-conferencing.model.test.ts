import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import { Message, update } from "../src/client/app.js";
import { agendaSnapshot } from "../src/client/desktop/snapshot.js";
import {
  savedUpcomingEvent,
  upcomingFixture,
  upcomingPerson,
} from "./upcoming-fixture.js";

it.effect.prop(
  "native publication recognizes saved conference text without publishing it or weakening HTTPS",
  {
    field: Arbitrary.schema(Schema.Literals(["location", "description"])),
    protocol: Arbitrary.schema(Schema.Literals(["https", "http"])),
    userInfo: Arbitrary.schema(Schema.Boolean),
  },
  ({ field, protocol, userInfo }) =>
    Effect.sync(() => {
      const link = `${protocol}://${userInfo ? "person@" : ""}meet.google.com/native-proof`;
      const text = `Private calendar note: ${link}`;
      const model = upcomingFixture();

      const received = update(
        model,
        Message.ReceivedUpcoming({
          personId: upcomingPerson,
          request: model.upcoming.request,
          result: {
            events: [{ ...savedUpcomingEvent, [field]: text }],
            versions: [],
          },
        })
      ).model;

      const snapshot = agendaSnapshot(received, defaultDesktopPreferences());
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0]?.conferenceUrl).toBe(
        protocol === "https" && !userInfo ? link : null
      );
      expect(JSON.stringify(snapshot)).not.toContain("Private calendar note");
      expect(snapshot.events[0]).not.toHaveProperty("description");
      expect(snapshot.events[0]).not.toHaveProperty("location");
    })
);
