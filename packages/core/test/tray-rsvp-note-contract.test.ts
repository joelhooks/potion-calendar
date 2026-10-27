import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";

import {
  AgendaKey,
  DesktopAction,
  desktopWire,
} from "../src/desktop-bridge.js";

it.effect.prop(
  "note preparation round-trips exact scope, expanded key, instant and choice without note text",
  {
    key: Arbitrary.schema(AgendaKey),
    response: Arbitrary.schema(
      Schema.Literals(["accepted", "declined", "tentative"])
    ),
    start: Arbitrary.schema(
      Schema.Int.check(
        Schema.isBetween({ maximum: 2_000_000_000_000, minimum: 0 })
      )
    ),
  },
  ({ key, response, start }) =>
    Effect.gen(function* roundTrip() {
      const action = DesktopAction.cases.PrepareRsvpNote.make({
        key,
        lease: "lease",
        personId: "person",
        response,
        start,
      });

      const wire = yield* Schema.encodeEffect(desktopWire.action)(action);
      expect(yield* Schema.decodeEffect(desktopWire.action)(wire)).toEqual(
        action
      );

      const extra = yield* Schema.decodeEffect(desktopWire.action)(
        JSON.stringify({ ...action, note: "Never import this draft" })
      );

      expect(extra).toEqual(action);
      expect(extra).not.toHaveProperty("note");
    })
);

it.effect(
  "preparation rejects incomplete ownership, malformed targets and non-choice responses",
  () =>
    Effect.gen(function* malformedInputs() {
      const valid = DesktopAction.cases.PrepareRsvpNote.make({
        key: {
          accountId: "work",
          calendarId: "primary",
          eventId: "series_20261021T090000Z",
        },
        lease: "lease",
        personId: "person",
        response: "accepted",
        start: 1_792_573_200_000,
      });

      for (const payload of [
        { ...valid, key: { eventId: "instance" } },
        { ...valid, key: { ...valid.key, accountId: "" } },
        { ...valid, lease: "" },
        { ...valid, personId: "" },
        { ...valid, start: null },
        { ...valid, start: "invalid" },
        { ...valid, response: "needsAction" },
        { ...valid, response: "yes" },
      ]) {
        expect(
          Option.isNone(
            Schema.decodeOption(desktopWire.action)(JSON.stringify(payload))
          )
        ).toBe(true);
      }

      expect(
        Option.isNone(
          Schema.decodeOption(desktopWire.action)(
            JSON.stringify(valid).replace(
              '"PrepareRsvpNote"',
              '"RespondWithNote"'
            )
          )
        )
      ).toBe(true);

      const plain = DesktopAction.cases.RespondToEvent.make({
        key: valid.key,
        response: "declined",
      });

      expect(
        yield* Schema.decodeEffect(desktopWire.action)(
          JSON.stringify({ ...plain, note: "Keep private" })
        )
      ).toEqual(plain);
    })
);
