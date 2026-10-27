import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import { initialTransition, transition } from "xstate";

import {
  PreparedRsvpNote,
  projectRsvp,
  rsvpMachine,
} from "../src/client/editing/rsvp-machine.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { editorOriginal } from "./editor-fixture.js";
import { recoveryEvent, recoveryIntent } from "./tray-note-recovery-fixture.js";

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
        "RETIRE_NOTE",
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

const DraftCommand = Schema.Struct({
  kind: Schema.Literals(["note", "retire", "cancel", "new", "late"]),
  note: Schema.String,
});

it.effect.prop(
  "generated local draft histories retain text and full identity across retirement and stale cancellation",
  {
    commands: Arbitrary.schema(
      Schema.Array(DraftCommand).check(Schema.isMaxLength(8))
    ),
  },
  ({ commands }) =>
    Effect.sync(() => {
      let [state] = initialTransition(rsvpMachine);
      [state] = transition(rsvpMachine, state, {
        event: recoveryEvent,
        intent: recoveryIntent,
        selectionKey: "merged-selection",
        type: "STAGE_NOTE",
      });
      let generation = 1;
      let phase: "Prepared" | "DetailsDraft" = "Prepared";
      let note = "";

      for (const command of commands) {
        if (command.kind === "note") {
          [state] = transition(rsvpMachine, state, {
            note: command.note,
            type: "NOTE",
          });
          ({ note } = command);
        } else if (command.kind === "new") {
          [state] = transition(rsvpMachine, state, {
            event: recoveryEvent,
            intent: recoveryIntent,
            selectionKey: "merged-selection",
            type: "STAGE_NOTE",
          });
          generation += 1;
          phase = "Prepared";
        } else {
          const id = command.kind === "late" ? generation - 1 : generation;
          [state] = transition(rsvpMachine, state, {
            prepared: PreparedRsvpNote.make({ id, intent: recoveryIntent }),
            type: command.kind === "cancel" ? "CLEAR_NOTE" : "RETIRE_NOTE",
          });

          if (command.kind !== "late") {
            phase = "DetailsDraft";
          }
        }

        const current = projectRsvp(state);
        expect(current.note).toBe(note);
        expect(current.draftTarget?._tag).toBe(phase);
        expect(current.draftTarget?.selectionKey).toBe("merged-selection");
        expect(current.draftTarget?.prepared.intent.key).toEqual(
          recoveryIntent.key
        );
        expect(current.draftTarget?.prepared.id).toBe(generation);
        expect(current.prepared !== undefined).toBe(phase === "Prepared");
        expect(Option.isNone(current.saving)).toBe(true);
      }
    })
);
