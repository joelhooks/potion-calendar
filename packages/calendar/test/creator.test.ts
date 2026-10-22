import { expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";

import { GoogleCalendarClient } from "../src/google.js";
import { EventFields } from "../src/model.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

it.effect(
  "Google creator metadata survives read decoding, including partial and absent identities",
  () =>
    Effect.gen(function* creatorDecodeCases() {
      const creators = [
        {
          displayName: "  Blair Design  ",
          email: " Blair@Example.test ",
          self: true,
        },
        { displayName: "Blair", self: false },
        { email: "blair@example.test" },
        {},
        undefined,
      ];

      const fake = yield* fakeGoogle(
        creators.map((creator) =>
          response(
            200,
            timedEvent(
              "abcde",
              "Meeting",
              creator === undefined ? {} : { creator }
            )
          )
        )
      );

      yield* Effect.gen(function* readCreatorCases() {
        const client = yield* GoogleCalendarClient;

        for (const creator of creators) {
          const event = yield* client.get({ ...ref, eventId: "abcde" });
          expect(event.creator).toEqual(creator);
        }
      }).pipe(
        Effect.provide(
          GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
        )
      );
    })
);

it.effect(
  "read-only creator is excluded from writable fields and unchanged Google insert/PATCH bodies",
  () =>
    Effect.gen(function* creatorWriteExclusion() {
      const fields = {
        end: { dateTime: "2026-10-20T11:00:00Z" },
        start: { dateTime: "2026-10-20T10:00:00Z" },
        title: "Planning",
      };

      const incoming = {
        ...fields,
        creator: { email: "creator@example.test", self: true },
      };

      const projected = yield* Schema.decodeEffect(EventFields)(incoming);

      expect(projected).toEqual(fields);

      const fake = yield* fakeGoogle([
        response(200, timedEvent("abcde")),
        response(200, timedEvent("abcde")),
      ]);

      yield* Effect.gen(function* writeProjectedFields() {
        const client = yield* GoogleCalendarClient;
        yield* client.create(ref, "abcde", projected, {});
        yield* client.patch({ ...ref, eventId: "abcde" }, projected, {});
      }).pipe(
        Effect.provide(
          GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
        )
      );
      const requests = yield* Ref.get(fake.requests);
      expect(requests.map((request) => request.method)).toEqual([
        "POST",
        "PATCH",
      ]);

      const bodies = yield* Effect.all(
        requests.map((request) =>
          Schema.decodeEffect(
            Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
          )(request.body ?? "{}")
        )
      );

      expect(bodies).toEqual([
        {
          end: fields.end,
          id: "abcde",
          start: fields.start,
          summary: "Planning",
        },
        { end: fields.end, start: fields.start, summary: "Planning" },
      ]);
    })
);
