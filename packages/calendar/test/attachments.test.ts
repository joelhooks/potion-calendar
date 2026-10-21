import { expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";

import { GoogleCalendarClient } from "../src/google.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

it.effect.prop(
  "provider attachments normalize on read; copy inserts opt in while title/time patches and events.move never rewrite attachment arrays",
  { email: Schema.Boolean, title: Schema.NonEmptyString },
  ({ title, email }) =>
    Effect.gen(function* attachmentRequests() {
      const raw = [
        {
          fileId: "read-only-id",
          fileUrl: "https://drive.google.com/file/d/reference/view",
          iconLink: "https://drive-thirdparty.googleusercontent.com/icon",
          mimeType: "application/pdf",
          title,
        },
      ];

      const expected = [
        {
          iconUrl: raw[0]?.iconLink,
          mimeType: "application/pdf",
          title,
          url: raw[0]?.fileUrl,
        },
      ];

      const wire = timedEvent("abcde", "Attachment meeting", {
        attachments: raw,
      });

      const fake = yield* fakeGoogle(
        Array.from({ length: 5 }, () => response(200, wire))
      );

      yield* Effect.gen(function* attachedEventFlow() {
        const google = yield* GoogleCalendarClient;
        const source = yield* google.get({ ...ref, eventId: "abcde" });
        expect(source.attachments).toEqual(expected);

        const options = {
          sendUpdates: email ? ("all" as const) : ("none" as const),
        };

        const copied = yield* google.create(
          ref,
          "copy1",
          { ...source, title: "Copy" },
          options
        );

        expect(copied.attachments).toEqual(expected);

        const edited = yield* google.patch(
          source,
          { title: "Renamed" },
          options
        );

        expect(edited.attachments).toEqual(expected);

        const timed = yield* google.patch(
          source,
          {
            end: { dateTime: "2026-10-20T11:00:00Z" },
            start: { dateTime: "2026-10-20T10:00:00Z" },
          },
          options
        );

        expect(timed.attachments).toEqual(expected);
        const moved = yield* google.move(source, "other-calendar", options);
        expect(moved.attachments).toEqual(expected);
      }).pipe(
        Effect.provide(
          GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
        )
      );

      const requests = yield* Ref.get(fake.requests);
      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "POST",
        "PATCH",
        "PATCH",
        "POST",
      ]);

      for (const [index, request] of requests.entries()) {
        const url = new URL(request.path, "https://calendar.test");

        if (index === 1) {
          expect(url.searchParams.get("supportsAttachments")).toBe("true");

          const body = yield* Schema.decodeEffect(
            Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
          )(request.body ?? "{}");

          expect(body.attachments).toEqual(
            raw.map(({ fileId: _fileId, ...attachment }) => attachment)
          );
        } else {
          expect(url.searchParams.has("supportsAttachments")).toBe(false);

          const body = yield* Schema.decodeEffect(
            Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
          )(request.body ?? "{}");

          expect(body).not.toHaveProperty("attachments");
        }

        if (index === 4) {
          expect(url.pathname).toMatch(/\/events\/abcde\/move$/u);
        }
      }
    })
);
