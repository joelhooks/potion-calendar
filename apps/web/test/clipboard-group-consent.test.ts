import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { send } from "@xstate/effect";
import { Effect } from "effect";

import {
  ClipboardEnvelope,
  ClipboardView,
  NativeClipboardNotice,
} from "../src/client/clipboard/model.js";
import { projectClipboard } from "../src/client/clipboard/projection.js";
import { clipboardItem } from "./clipboard-fixture.js";
import {
  clipboardHarness,
  pasteFact,
  waitClipboard,
} from "./clipboard-runtime-fixture.js";

it.effect(
  "one incomplete member disables invitations for the whole group; a forged include choice writes nothing and a new exclude intent still pastes every member without email",
  () =>
    Effect.scoped(
      Effect.gen(function* incompleteGroupConsent() {
        const { actor, calls } = yield* clipboardHarness(0);
        const first = clipboardItem();

        const envelope = ClipboardEnvelope.make({
          id: "incomplete-group",
          items: [
            first,
            {
              ...first,
              guestsComplete: false,
              source: { ...first.source, eventId: "other-source" },
            },
          ],
          personId: "person-A",
          selectionKeys: ["complete", "incomplete"],
          version: 1,
        });

        yield* send(actor, {
          notice: NativeClipboardNotice.cases.Copied.make({
            envelope,
            mode: "copy",
            personId: "person-A",
            sequence: 1,
            sessionId: "native-fixture",
          }),
          type: "NATIVE",
        });
        yield* waitClipboard(
          actor,
          (snapshot) => snapshot.context.envelope?.id === envelope.id
        );
        yield* send(actor, {
          notice: pasteFact(2, envelope.id),
          type: "NATIVE",
        });

        const firstChoice = yield* waitClipboard(actor, (snapshot) =>
          snapshot.matches("guests")
        );

        const projected = yield* Effect.succeed(
          projectClipboard(firstChoice)
        ).pipe(
          Effect.filterOrElse(ClipboardView.guards.Guests, () =>
            Effect.die("Group guest projection missing")
          )
        );

        expect(projected.complete).toBe(false);
        expect(projected.itemCount).toBe(2);
        expect(calls).toHaveLength(0);
        yield* send(actor, {
          choice: "includeAndEmail",
          intentId: firstChoice.context.pending?.intentId ?? "missing",
          type: "GUESTS",
        });
        yield* waitClipboard(
          actor,
          (snapshot) =>
            snapshot.matches("ready") &&
            snapshot.context.toast?.message.includes("incomplete") === true
        );
        expect(calls).toHaveLength(0);
        yield* send(actor, {
          notice: pasteFact(3, envelope.id),
          type: "NATIVE",
        });

        const secondChoice = yield* waitClipboard(
          actor,
          (snapshot) =>
            snapshot.matches("guests") &&
            snapshot.context.pending?.intentId !==
              firstChoice.context.pending?.intentId
        );

        yield* send(actor, {
          choice: "exclude",
          intentId: secondChoice.context.pending?.intentId ?? "missing",
          type: "GUESTS",
        });

        const finished = yield* waitClipboard(
          actor,
          (snapshot) => snapshot.context.groupResult?.mutations.length === 2
        );

        expect(finished.context.groupResult?.issues).toEqual([]);
        expect(calls).toHaveLength(2);
        expect(
          calls.every(
            (call) =>
              call.sendUpdates === "none" && call.event.attendees?.length === 0
          )
        ).toBe(true);
      })
    ).pipe(Effect.provide(NodeServices.layer))
);
