import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { send } from "@xstate/effect";
import { Effect, Schema } from "effect";

import {
  ClipboardEnvelope,
  NativeClipboardNotice,
} from "../src/client/clipboard/model.js";
import { clipboardItem } from "./clipboard-fixture.js";
import {
  clipboardHarness,
  clipboardPoint,
  clipboardTarget,
  waitClipboard,
} from "./clipboard-runtime-fixture.js";

const history = Schema.Array(
  Schema.Literals([
    "copy",
    "paste",
    "include",
    "exclude",
    "cancel",
    "staleConsent",
    "foreignEnvelope",
    "retry",
    "retire",
  ])
).check(Schema.isMinLength(1), Schema.isMaxLength(12));

interface HistoryModel {
  readonly phase: "empty" | "ready" | "guests" | "retired";
  readonly copiedId: string;
  readonly writes: number;
}

const advanceHistory = (
  model: HistoryModel,
  command: (typeof history.Type)[number],
  index: number
): HistoryModel => {
  if (model.phase === "retired") {
    return model;
  }

  const idle = model.phase === "ready" || model.phase === "empty";

  if (command === "retire") {
    return { ...model, phase: "retired" };
  }

  if (command === "copy" && idle) {
    return { ...model, copiedId: `history-copy-${index}`, phase: "ready" };
  }

  if (command === "foreignEnvelope" && idle) {
    return { ...model, phase: "empty" };
  }

  if (command === "paste" && model.phase === "ready") {
    return { ...model, phase: "guests" };
  }

  if (
    (command === "include" || command === "exclude") &&
    model.phase === "guests"
  ) {
    return { ...model, phase: "ready", writes: model.writes + 3 };
  }

  if (command === "cancel" && model.phase === "guests") {
    return { ...model, phase: "ready" };
  }

  return model;
};

it.effect.prop(
  "generated group command histories keep ownership, one consent boundary, cancellation, terminal retirement and fresh deliberate-paste identities",
  { history },
  ({ history: commands }) =>
    Effect.scoped(
      Effect.gen(function* groupHistory() {
        const { actor, calls } = yield* clipboardHarness(0);

        let model: HistoryModel = {
          copiedId: "missing-copy",
          phase: "empty",
          writes: 0,
        };

        let sessionId = "native-fixture";

        for (const [index, command] of commands.entries()) {
          const { pending } = actor.getSnapshot().context;
          const intentId = pending?.intentId ?? "missing-intent";

          if (command === "copy" || command === "foreignEnvelope") {
            const first = clipboardItem();

            const items = [
              first,
              ...[1, 2].map((item) => ({
                ...first,
                source: { ...first.source, eventId: `member-${item}` },
              })),
            ];

            const notice = NativeClipboardNotice.cases.Copied.make({
              envelope: ClipboardEnvelope.make({
                id: `history-copy-${index}`,
                items: [first, ...items.slice(1)],
                personId: command === "copy" ? "person-A" : "person-B",
                selectionKeys: ["first", "second", "third"],
                version: 1,
              }),
              mode: "copy",
              personId: "person-A",
              sequence: 1,
              sessionId,
            });

            yield* send(actor, { notice, type: "NATIVE" });
          } else if (command === "paste") {
            yield* send(actor, {
              notice: NativeClipboardNotice.cases.Paste.make({
                anchor: clipboardPoint,
                copyId: model.copiedId,
                personId: "person-A",
                sequence: 1,
                sessionId,
                target: clipboardTarget,
              }),
              type: "NATIVE",
            });
          } else if (
            command === "include" ||
            command === "exclude" ||
            command === "staleConsent"
          ) {
            yield* send(actor, {
              choice: command === "exclude" ? "exclude" : "includeAndEmail",
              intentId: command === "staleConsent" ? "stale-intent" : intentId,
              type: "GUESTS",
            });
          } else if (command === "cancel") {
            yield* send(actor, { intentId, type: "CANCEL" });
          } else if (command === "retry") {
            yield* send(actor, { intentId, type: "RETRY" });
          } else {
            yield* send(actor, { type: "RETIRE" });
          }

          model = advanceHistory(model, command, index);
          const { phase, writes: expectedWrites } = model;

          if (phase === "retired") {
            yield* waitClipboard(
              actor,
              (snapshot) => snapshot.status === "done"
            );
          } else {
            const nextSession = `history-session-${index}`;
            sessionId = nextSession;
            yield* send(actor, {
              sessionId: nextSession,
              type: "ATTACH_NATIVE",
            });
            yield* waitClipboard(
              actor,
              (snapshot) =>
                snapshot.context.nativeSessionId === nextSession &&
                snapshot.matches(phase)
            );
          }

          expect(calls).toHaveLength(expectedWrites);
          expect(new Set(calls.map((call) => call.id)).size).toBe(
            expectedWrites
          );
          expect(actor.getSnapshot().context.envelope === undefined).toBe(
            phase === "empty" || phase === "retired"
          );

          if (phase === "retired") {
            expect(actor.getSnapshot().context.pending).toBeUndefined();
          }
        }
      })
    ).pipe(Effect.provide(NodeServices.layer))
);
