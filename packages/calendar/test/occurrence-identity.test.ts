import { expect, it } from "@effect/vitest";
import { Effect, Layer, Result, Schema } from "effect";

import { readNeighborOccurrence } from "../src/capabilities.js";
import { GoogleCalendarClient } from "../src/google.js";
import { fakeGoogle, ref, response, timedEvent } from "./fake-google.js";

it.effect.prop(
  "an active page item with unusable series identity is a typed failure, never an empty occurrence result",
  {
    direction: Schema.Literals(["next", "previous"]),
    missing: Schema.Literals(["uid", "series", "both"]),
  },
  ({ direction, missing }) =>
    Effect.gen(function* incompletePageIdentity() {
      const anchor = timedEvent("anchor", "Anchor", {
        originalStartTime: { dateTime: "2026-03-15T16:00:00Z" },
        recurringEventId: "series",
      });

      const candidate = timedEvent("candidate", "Incomplete identity", {
        originalStartTime: { dateTime: "2026-03-15T16:00:00Z" },
        recurringEventId: "series",
      });

      const variants = {
        both: { ...candidate, iCalUID: "", recurringEventId: "" },
        series: { ...candidate, recurringEventId: "" },
        uid: { ...candidate, iCalUID: "" },
      };

      const fake = yield* fakeGoogle([
        response(200, anchor),
        response(200, { items: [variants[missing]] }),
      ]);

      const outcome = yield* readNeighborOccurrence
        .handler({ ...ref, direction, eventId: "anchor" })
        .pipe(
          Effect.provide(
            GoogleCalendarClient.layer.pipe(Layer.provide(fake.layer))
          ),
          Effect.result
        );

      expect(Result.isFailure(outcome)).toBe(true);
    })
);
