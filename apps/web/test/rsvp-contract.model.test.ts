import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { rsvpMachine } from "../src/client/editing/rsvp-machine.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { editorOriginal } from "./editor-fixture.js";

const legacyKeyboardCommand = Schema.TaggedStruct("RsvpKey", {
  event: Schema.Option(CalendarEvent),
  key: Schema.String,
});

it.effect(
  "the RSVP actor exposes domain actions, never a legacy keyboard channel",
  () =>
    Effect.sync(() => {
      expect(
        rsvpMachine.events
          .filter((event) => !event.startsWith("xstate."))
          .toSorted()
      ).toEqual([
        "CHOOSE",
        "CLEAR_NOTE",
        "FOCUS",
        "NOTE",
        "RESPOND",
        "STAGE_NOTE",
      ]);
      expect(rsvpMachine.states).not.toHaveProperty("prefix");
      expect(
        Schema.is(EditingCommand)(
          legacyKeyboardCommand.make({
            event: Option.some(editorOriginal),
            key: "e",
          })
        )
      ).toBe(false);
    })
);
