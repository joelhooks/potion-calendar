import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { AsyncData } from "foldkit";
import { UrlRequest } from "foldkit/navigation";

import { Message, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { participantEmail } from "../src/layout/email-participants.js";
import { ordinaryLink } from "../src/layout/event-links.js";
import {
  emailFixture,
  expectedParticipantHref,
} from "./email-participants-fixture.js";

const source = () => {
  const model = emailFixture("button");

  return Option.getOrThrow(
    AsyncData.getData(
      Option.getOrThrow(Option.fromUndefinedOr(model.calendar.reads[0])).events
    )
  ).events[0];
};

it.effect.prop(
  "recipients preserve provider spelling and order while excluding all own identities, resources and case-insensitive duplicates",
  {
    names: Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 1 }))
    ).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
    uppercase: Schema.Boolean,
  },
  ({ names, uppercase }) =>
    Effect.sync(() => {
      const event = Option.getOrThrow(Option.fromUndefinedOr(source()));

      const expected = [...new Set(names)].map(
        (name) => `${uppercase ? "Guest" : "guest"}${name}+tag@example.test`
      );

      const result = participantEmail(
        {
          ...event,
          attendees: [
            { email: "OWNER@example.test" },
            { email: "personal@example.test" },
            { email: "alias@example.test", self: true },
            { email: "room@example.test", resource: true },
            ...expected.flatMap((email) => [
              { email },
              { email: email.toUpperCase() },
            ]),
          ],
          title: "Design & review / café? #1",
        },
        ["owner@example.test", "PERSONAL@example.test"]
      );

      expect(result.kind).toBe("ready");

      if (result.kind !== "ready") {
        throw new Error("Expected eligible recipient set");
      }

      expect(result.recipients).toEqual(expected);
      expect(result.href).toBe(
        `mailto:${expected.map((email) => email.replaceAll("+", "%2B")).join(",")}?subject=Design%20%26%20review%20%2F%20caf%C3%A9%3F%20%231`
      );
      expect(ordinaryLink(result.href)).toBe(result.href);
      expect(new URL(result.href).searchParams.get("subject")).toBe(
        "Design & review / café? #1"
      );
      expect(new URL(result.href).searchParams.has("body")).toBe(false);
    })
);

it.effect(
  "the URL limit measures the full encoded URL and never truncates recipients or title",
  () =>
    Effect.sync(() => {
      const event = Option.getOrThrow(Option.fromUndefinedOr(source()));

      const base = {
        ...event,
        attendees: [{ email: "guest@example.test" }],
        title: "",
      };

      const prefix = "mailto:guest@example.test?subject=";

      const exact = participantEmail(
        { ...base, title: "x".repeat(2000 - prefix.length) },
        []
      );

      expect(exact.kind).toBe("ready");

      if (exact.kind === "ready") {
        expect(exact.href).toHaveLength(2000);
      }

      expect(
        participantEmail(
          { ...base, title: "x".repeat(2001 - prefix.length) },
          []
        )
      ).toEqual({
        kind: "disabled",
        reason: "Too many guests to email from here.",
      });
      expect(
        participantEmail({ ...base, title: "é".repeat(400) }, []).kind
      ).toBe("disabled");
    })
);

it.effect(
  "hidden and incomplete lists fail closed even when cached rows include other guests; organizers may see their complete list",
  () =>
    Effect.sync(() => {
      const event = Option.getOrThrow(Option.fromUndefinedOr(source()));
      expect(
        participantEmail({ ...event, guestsCanSeeOtherGuests: false }, [])
      ).toEqual({
        kind: "disabled",
        reason: "The organizer has hidden the guest list.",
      });
      expect(
        participantEmail({ ...event, attendeesOmitted: true }, [])
      ).toEqual({
        kind: "disabled",
        reason: "Google didn't send the full guest list.",
      });
      expect(
        participantEmail(
          {
            ...event,
            guestsCanSeeOtherGuests: false,
            organizer: { self: true },
          },
          []
        ).kind
      ).toBe("ready");

      for (const title of ["Header\r\nBcc:other@example.test", "\uD800"]) {
        expect(participantEmail({ ...event, title }, []).kind).toBe("disabled");
      }

      expect(
        participantEmail(
          { ...event, attendees: [{ email: "bad\r\nBcc:other@example.test" }] },
          []
        ).kind
      ).toBe("disabled");
    })
);

it.effect(
  "button and E E share the external safe-link command without any provider operation; ineligible direct messages are inert",
  () =>
    Effect.sync(() => {
      const before = emailFixture("button");
      const clicked = update(before, Message.RequestedEmailParticipants());

      const first = update(
        before,
        Message.PressedCalendarKey({
          alt: false,
          key: "e",
          mod: false,
          now: 100,
          shift: false,
        })
      ).model;

      const keyed = update(
        first,
        Message.PressedCalendarKey({
          alt: false,
          key: "e",
          mod: false,
          now: 101,
          shift: false,
        })
      );

      for (const result of [clicked, keyed]) {
        expect(result.commands?.map((command) => command.name)).toEqual([
          "FollowRouteRequest",
        ]);
        expect(result.commands?.[0]?.args).toEqual({
          request: UrlRequest.External({ href: expectedParticipantHref }),
        });
      }

      for (const scene of ["hidden", "solo", "omitted"] as const) {
        const model = emailFixture(scene);
        const result = update(model, Message.RequestedEmailParticipants());
        expect(result.model).toEqual(model);
        expect(result.commands ?? []).toEqual([]);
      }

      const foreign = { ...before, person: Option.some("another-person") };
      expect(
        update(foreign, Message.RequestedEmailParticipants()).commands ?? []
      ).toEqual([]);
    })
);

it.effect(
  "the root excludes another linked identity without relying on self flags and refuses ambiguous selection",
  () =>
    Effect.sync(() => {
      const base = emailFixture("button");
      const event = Option.getOrThrow(Option.fromUndefinedOr(source()));

      const model = {
        ...base,
        calendar: {
          ...base.calendar,
          reads: [
            {
              accountId: "work",
              events: RemoteEvents.Success({
                data: {
                  events: [
                    {
                      ...event,
                      attendees: [
                        { email: "PERSONAL@example.test" },
                        { email: "guest@example.test" },
                      ],
                    },
                  ],
                  versions: [],
                },
              }),
            },
          ],
        },
      };

      expect(
        update(model, Message.RequestedEmailParticipants()).commands?.[0]?.args
      ).toEqual({
        request: UrlRequest.External({
          href: "mailto:guest@example.test?subject=Weekly%20sync",
        }),
      });

      for (const selected of [
        [],
        ["another-event", ...base.calendar.selected],
      ]) {
        const target = { ...model, calendar: { ...model.calendar, selected } };
        expect(
          update(target, Message.RequestedEmailParticipants()).commands ?? []
        ).toEqual([]);
      }
    })
);
