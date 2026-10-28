import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, Result, Schema } from "effect";

import { CalendarService } from "../src/calendar.js";
import { ConferencingDefaults } from "../src/conferencing-defaults.js";
import { conferenceLink } from "../src/conferencing-link.js";
import {
  appendCustomVideoLink,
  CustomVideoLink,
  CustomVideoReference,
} from "../src/custom-video-link.js";
import { requestedConferenceData } from "../src/google-conferencing.js";
import { GoogleCalendarClient } from "../src/google.js";
import { memoryCalendarStore } from "../src/memory.js";
import { Provider } from "../src/provider.js";
import {
  fakeGoogle,
  fakeGoogleCrypto,
  ref,
  response,
  timedEvent,
} from "./fake-google.js";

it.effect.prop(
  "exact href values and anchor text preserve custom URLs without accepting prefixes or sentence punctuation",
  {
    token: Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 0 })),
  },
  ({ token }) =>
    Effect.sync(() => {
      for (const link of [
        `https://room.example/room-${token}`,
        `https://room.example/team's-${token}`,
      ]) {
        const entry = { id: "html-room", link, name: "HTML room" };

        const exact = [
          `<a href="${link}">Room</a>`,
          `<a HREF = "${link}">Room</a>`,
          `<a href="https://other.example/">${link}</a>`,
          `<p>${link}</p>`,
          ...(link.includes("'") ? [] : [`<a href='${link}'>Room</a>`]),
        ];

        for (const description of exact) {
          expect(
            appendCustomVideoLink(description, link),
            "an exact HTML custom URL must not be appended twice"
          ).toBe(description);
          expect(
            conferenceLink(undefined, undefined, description, [entry])
          ).toBe(link);
        }

        for (const description of [
          `<a href="${link}/child">Room</a>`,
          `<a href="${link}-suffix">Room</a>`,
          `<a href="https://other.example/?url=${link}">Room</a>`,
          `<a data-href="${link}">Room</a>`,
          `<p>prefix${link}</p>`,
          ...[".", ",", ")"].flatMap((suffix) => [
            link + suffix,
            `<p>${link}${suffix}</p>`,
          ]),
        ]) {
          expect(
            appendCustomVideoLink(description, link),
            "only a complete custom URL in an approved context may suppress append"
          ).toBe(`${description}\n${link}`);
          expect(
            conferenceLink(undefined, undefined, description, [entry])
          ).toBeUndefined();
        }
      }
    })
);

it.effect.prop(
  "exact accepted custom URLs including apostrophes preserve description while longer URLs still require an append",
  {
    token: Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 0 })),
  },
  ({ token }) =>
    Effect.gen(function* exactCustomUrlBoundaries() {
      for (const link of [
        `https://room.example/team's-${token}`,
        `http://room.example/${token}?owner=o'reilly#it's`,
        `https://room.example/a"b-${token}`,
        `https://room.example/a<b>-${token}`,
        `https://room.example/room ${token}`,
      ]) {
        const accepted = yield* Schema.decodeUnknownEffect(CustomVideoLink)({
          id: "accepted-room",
          link,
          name: "Accepted room",
        });

        for (const [before, after] of [
          ["", ""],
          ["Agenda\n", "\nNotes"],
          ["<", ">"],
          ['"', '"'],
          ["'", "'"],
        ]) {
          const description = `${before}${accepted.link}${after}`;
          expect(
            appendCustomVideoLink(description, accepted.link),
            "an exact accepted URL including apostrophes must not be appended twice"
          ).toBe(description);
        }

        for (const description of [
          `${accepted.link}-suffix`,
          `${accepted.link}/child`,
          `${accepted.link}'suffix`,
          `https://prefix.example/?url=${accepted.link}`,
          `prefix${accepted.link}`,
        ]) {
          expect(
            appendCustomVideoLink(description, accepted.link),
            "a prefix or longer URL must not suppress the exact custom URL"
          ).toBe(`${description}\n${accepted.link}`);
        }
      }
    })
);

const fields = {
  end: { dateTime: "2026-10-20T11:00:00Z" },
  start: { dateTime: "2026-10-20T10:00:00Z" },
};

const room = { id: "room", link: "https://room.example/current", name: "Room" };

const choice = CustomVideoReference.make({ id: room.id, kind: "customLink" });

const bodySchema = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Json)
);

const fixture = Effect.fnUntraced(function* fixture() {
  const current = yield* Ref.make(Option.some(room));

  const fake = yield* fakeGoogle([
    response(200, timedEvent("abcde")),
    response(200, timedEvent("abcde")),
    response(200, timedEvent("abcde")),
  ]);

  const defaults = Layer.succeed(ConferencingDefaults, {
    forAccount: () => Effect.succeed(choice),
    resolveCustomLink: (id) =>
      Ref.get(current).pipe(
        Effect.flatMap((value) =>
          Option.isSome(value) && value.value.id === id
            ? Effect.succeed(value.value)
            : Effect.fail(
                new Provider({
                  message: "The saved link no longer exists",
                  operation: "customVideoLink.resolve",
                  status: 409,
                })
              )
        )
      ),
  });

  const layer = CalendarService.layer.pipe(
    Layer.provide(defaults),
    Layer.provideMerge(
      GoogleCalendarClient.layer.pipe(
        Layer.provideMerge(Layer.merge(fake.layer, memoryCalendarStore))
      )
    )
  );

  return { current, fake, layer };
});

it.effect.prop(
  "custom defaults resolve the current URL once, preserve location and never invent provider conference data",
  {
    alreadyPresent: Schema.Boolean,
    explicit: Schema.Boolean,
    token: Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: 0 })),
  },
  ({ explicit, alreadyPresent, token }) =>
    Effect.gen(function* currentLink() {
      const { current, fake, layer } = yield* fixture();
      const latest = `https://room.example/edited-${token}`;
      yield* Ref.set(current, Option.some({ ...room, link: latest }));
      const description = alreadyPresent ? `Agenda\n${latest}` : "Agenda";
      yield* CalendarService.use((service) =>
        service.createEvent({
          ...ref,
          conferencingRequest: explicit ? choice : undefined,
          event: {
            ...fields,
            attendees: [{ email: "guest@example.test" }],
            description,
            location: "Office 12",
          },
          id: "abcde",
        })
      ).pipe(Effect.provide(layer));
      const requests = yield* Ref.get(fake.requests);
      const writes = requests.filter((request) => request.method === "POST");
      expect(writes).toHaveLength(1);

      const body = yield* Schema.decodeUnknownEffect(bodySchema)(
        writes[0]?.body
      );

      expect(
        body.description,
        "edited custom reference must resolve its current server URL"
      ).toBe(`Agenda\n${latest}`);
      expect(body.location, "custom link must preserve location").toBe(
        "Office 12"
      );
      expect(
        body,
        "custom link must never invent provider conference data"
      ).not.toHaveProperty("conferenceData");
      expect(body).not.toHaveProperty("conferencingRequest");
      expect(
        new URL(
          writes[0]?.path ?? "",
          "https://calendar.test"
        ).searchParams.get("sendUpdates")
      ).toBe("none");
    })
);

it.effect.prop(
  "removed custom references refuse before provider creation instead of inheriting or falling back",
  { automatic: Schema.Boolean },
  ({ automatic }) =>
    Effect.gen(function* removedReference() {
      const { current, fake, layer } = yield* fixture();
      yield* Ref.set(current, Option.none());

      const outcome = yield* CalendarService.use((service) =>
        service.createEvent({
          ...ref,
          conferencingRequest: automatic ? undefined : choice,
          event: { ...fields, attendees: [{ email: "guest@example.test" }] },
          id: "abcde",
        })
      ).pipe(Effect.provide(layer), Effect.result);

      expect(
        (yield* Ref.get(fake.requests)).filter(
          (request) => request.method === "POST"
        ),
        "removed custom link must produce zero provider creates"
      ).toHaveLength(0);
      expect(Result.isFailure(outcome)).toBe(true);
    })
);

it.effect.prop(
  "self and resource attendees do not apply an account custom default",
  {
    mode: Schema.Literals(["self", "resource"]),
  },
  ({ mode }) =>
    Effect.gen(function* ineligibleParticipant() {
      const { fake, layer } = yield* fixture();
      yield* CalendarService.use((service) =>
        service.createEvent({
          ...ref,
          event: {
            ...fields,
            attendees:
              mode === "self"
                ? [{ email: "owner@example.test" }]
                : [{ email: "room@example.test", resource: true }],
            description: "Agenda",
          },
          id: "abcde",
        })
      ).pipe(Effect.provide(layer));

      const write = (yield* Ref.get(fake.requests)).find(
        (request) => request.method === "POST"
      );

      const body = yield* Schema.decodeUnknownEffect(bodySchema)(write?.body);
      expect(body.description).toBe("Agenda");
      expect(body).not.toHaveProperty("conferenceData");
    })
);

it.effect(
  "the Google serializer refuses unresolved custom intent rather than falling through to Meet",
  () =>
    Effect.gen(function* providerBoundary() {
      const outcome = yield* requestedConferenceData(choice).pipe(
        Effect.provide(fakeGoogleCrypto),
        Effect.result
      );

      expect(
        Result.isFailure(outcome),
        "unresolved custom intent must never become provider conference data"
      ).toBe(true);
    })
);
