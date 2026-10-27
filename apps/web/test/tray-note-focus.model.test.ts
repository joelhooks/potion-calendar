import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";

import {
  NoteFocusTarget,
  NoteFocusTicket,
  initialNoteFocus,
  transitionNoteFocus,
} from "../src/client/desktop/rsvp-note-focus.js";

const FocusHistory = Schema.Array(
  Schema.Literals([
    "own",
    "busy",
    "idle",
    "cancel",
    "replace",
    "retire",
    "commit",
    "late-commit",
    "same-context",
  ])
).check(Schema.isMaxLength(8));

interface OwnershipModel {
  busy: boolean;
  owner: string | undefined;
  pending: typeof NoteFocusTicket.Type | undefined;
  serial: number;
  token: string | undefined;
  waiting: boolean;
}

const observeOwnership = (previous: OwnershipModel, command: string) => {
  const next = { ...previous };

  if (command === "replace" || command === "retire") {
    next.serial += 1;
    next.token = command === "replace" ? `copy-${next.serial}` : undefined;
    next.owner = undefined;
    next.waiting = false;
    next.pending = undefined;
  } else if (command !== "same-context") {
    next.busy = command === "busy";
  }

  if (next.busy && !previous.busy && next.owner !== undefined) {
    next.waiting = true;
    next.pending = undefined;
  }

  return {
    eligible:
      previous.busy &&
      !next.busy &&
      next.waiting &&
      next.owner !== undefined &&
      next.owner === next.token,
    next,
  };
};

it.effect.prop(
  "generated focus histories preserve cancellation and consume each eligible ownership ticket once",
  {
    commands: Arbitrary.schema(FocusHistory),
  },
  ({ commands }) =>
    Effect.sync(() => {
      let state = initialNoteFocus();
      let token: string | undefined = "copy-0";
      let owner: string | undefined = token;
      let busy = true;
      let waiting = true;
      let serial = 0;
      let pending: typeof NoteFocusTicket.Type | undefined;
      const tickets: (typeof NoteFocusTicket.Type)[] = [];

      const target = () =>
        token === undefined
          ? Option.none()
          : Option.some(NoteFocusTarget.make({ pane: "desktop", token }));

      state = transitionNoteFocus(state, {
        busy: false,
        target: target(),
        type: "Observe",
      });
      state = transitionNoteFocus(state, { token, type: "Own" });
      state = transitionNoteFocus(state, {
        busy,
        target: target(),
        type: "Observe",
      });

      for (const command of commands) {
        if (command === "cancel") {
          owner = undefined;
          waiting = false;
          pending = undefined;
          state = transitionNoteFocus(state, { type: "Cancel" });
        } else if (command === "own") {
          if (token !== undefined) {
            state = transitionNoteFocus(state, { token, type: "Own" });

            if (!busy) {
              owner = token;
              pending = undefined;
            }
          }
        } else if (command === "commit" || command === "late-commit") {
          const ticket = command === "commit" ? tickets.at(-1) : tickets[0];

          if (ticket !== undefined) {
            const allowed =
              pending?.epoch === ticket.epoch && owner === token && !busy;

            state = transitionNoteFocus(state, { type: "Commit", ...ticket });

            if (allowed) {
              pending = undefined;
            }
          }
        } else {
          const { next, eligible } = observeOwnership(
            { busy, owner, pending, serial, token, waiting },
            command
          );

          ({ busy, owner, pending, serial, token, waiting } = next);

          state = transitionNoteFocus(state, {
            busy,
            target: target(),
            type: "Observe",
          });

          if (eligible) {
            expect(
              state.matches("pending"),
              "only a live owned busy-to-idle transition may issue a ticket"
            ).toBe(true);
            pending = NoteFocusTicket.make({
              epoch: state.context.epoch,
              target: Option.getOrThrow(target()),
            });
            tickets.push(pending);
            waiting = false;
          }
        }

        expect(
          state.matches("pending"),
          "cancelled or consumed ownership cannot retain a pending restoration"
        ).toBe(pending !== undefined);
      }

      state = transitionNoteFocus(state, { type: "Dispose" });
      const disposed = state;
      state = transitionNoteFocus(state, { token: "copy-0", type: "Own" });
      state = transitionNoteFocus(state, {
        busy: false,
        target: target(),
        type: "Observe",
      });
      expect(state).toBe(disposed);
    })
);

it.effect(
  "a completed ticket cannot restore a second time or across a newer busy generation",
  () =>
    Effect.sync(() => {
      const target = NoteFocusTarget.make({
        pane: "phone",
        token: "current-copy",
      });

      let state = initialNoteFocus();
      state = transitionNoteFocus(state, {
        busy: false,
        target: Option.some(target),
        type: "Observe",
      });
      state = transitionNoteFocus(state, { token: target.token, type: "Own" });
      state = transitionNoteFocus(state, {
        busy: true,
        target: Option.some(target),
        type: "Observe",
      });
      state = transitionNoteFocus(state, {
        busy: false,
        target: Option.some(target),
        type: "Observe",
      });
      const old = NoteFocusTicket.make({ epoch: state.context.epoch, target });
      state = transitionNoteFocus(state, { type: "Commit", ...old });
      expect(state.matches("owned"), "commit consumes the pending ticket").toBe(
        true
      );
      const consumed = state.context.epoch;
      state = transitionNoteFocus(state, { type: "Commit", ...old });
      expect(state.context.epoch).toBe(consumed);
      state = transitionNoteFocus(state, {
        busy: true,
        target: Option.some(target),
        type: "Observe",
      });
      state = transitionNoteFocus(state, {
        busy: false,
        target: Option.some(target),
        type: "Observe",
      });
      state = transitionNoteFocus(state, { type: "Commit", ...old });
      expect(
        state.matches("pending"),
        "a stale callback cannot consume the newer busy cycle ticket"
      ).toBe(true);
    })
);
