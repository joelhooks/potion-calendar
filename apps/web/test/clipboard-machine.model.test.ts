import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { send } from "@xstate/effect";
import { Effect, Schema } from "effect";

import { ClipboardReceipt } from "../src/client/clipboard/machine.js";
import {
  ClipboardEnvelope,
  ClipboardInputFailure,
  ClipboardItem,
  ClipboardPasteTarget,
  NativeClipboardNotice,
} from "../src/client/clipboard/model.js";
import { projectClipboard } from "../src/client/clipboard/projection.js";
import {
  clipboardHarness,
  copiedFact,
  pasteFact,
  waitClipboard,
} from "./clipboard-runtime-fixture.js";

it.effect.prop(
  "owned clipboard histories preserve the latest copy across native leases, foreign and stale deliveries",
  {
    commands: Schema.Array(
      Schema.Literals([
        "copy",
        "cut",
        "invalidate",
        "stale",
        "foreign",
        "lease",
      ])
    ).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  },
  ({ commands }) =>
    Effect.gen(function* clipboardHistory() {
      const h = yield* clipboardHarness(0);
      let sessionId = "native-fixture";
      let sequence = 1;
      const original = copiedFact(1, "cut");
      yield* send(h.actor, { notice: original, type: "NATIVE" });
      yield* waitClipboard(
        h.actor,
        (snapshot) => snapshot.context.lastNativeSequence === 1
      );
      let expected: string | undefined = original.envelope.id;

      for (const [index, command] of commands.entries()) {
        if (command === "lease") {
          sessionId = `native-replacement-${index}`;
          sequence = 0;
          const attachedSession = sessionId;
          yield* send(h.actor, { sessionId, type: "ATTACH_NATIVE" });
          yield* waitClipboard(
            h.actor,
            (snapshot) => snapshot.context.nativeSessionId === attachedSession
          );
        } else if (command === "copy" || command === "cut") {
          sequence += 1;
          const notice = copiedFact(sequence, command, "person-A", sessionId);
          expected = notice.envelope.id;
          yield* send(h.actor, { notice, type: "NATIVE" });
        } else if (command === "invalidate") {
          sequence += 1;
          yield* send(h.actor, {
            notice: NativeClipboardNotice.cases.Invalidated.make({
              copyId: expected ?? "previous-copy",
              personId: "person-A",
              sequence,
              sessionId,
            }),
            type: "NATIVE",
          });
          expected = undefined;
        } else if (command === "foreign") {
          sequence += 1;
          yield* send(h.actor, {
            notice: copiedFact(sequence, "cut", "person-B", sessionId),
            type: "NATIVE",
          });
        } else {
          yield* send(h.actor, { notice: original, type: "NATIVE" });
        }

        sequence += 1;
        const checkpoint = sequence;
        yield* send(h.actor, {
          notice: NativeClipboardNotice.cases.Refused.make({
            failure: new ClipboardInputFailure({
              message: "Clipboard data is unavailable.",
              reason: "nativeUnavailable",
            }),
            operation: "paste",
            personId: "person-A",
            sequence,
            sessionId,
          }),
          type: "NATIVE",
        });

        const current = yield* waitClipboard(
          h.actor,
          (snapshot) => snapshot.context.lastNativeSequence === checkpoint
        );

        expect(current.context.envelope?.id).toBe(expected);
        expect(h.calls).toHaveLength(0);
      }

      yield* send(h.actor, { type: "RETIRE" });

      const retired = yield* waitClipboard(
        h.actor,
        (snapshot) => snapshot.status === "done"
      );

      expect(retired.context.envelope).toBeUndefined();
      expect(retired.context.pending).toBeUndefined();
      expect(retired.context.receipt).toBeUndefined();
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "one explicit guest decision drives one normal creation intent through generated retry histories",
  {
    failures: Schema.Int.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(2)
    ),
    include: Schema.Boolean,
  },
  ({ failures, include }) =>
    Effect.gen(function* pasteHistory() {
      const h = yield* clipboardHarness(failures);
      const copy = copiedFact(1, "copy");
      yield* send(h.actor, { notice: copy, type: "NATIVE" });
      yield* waitClipboard(
        h.actor,
        (snapshot) => snapshot.context.envelope?.id === copy.envelope.id
      );
      yield* send(h.actor, {
        notice: pasteFact(2, copy.envelope.id),
        type: "NATIVE",
      });

      const guests = yield* waitClipboard(h.actor, (snapshot) =>
        snapshot.matches("guests")
      );

      const intentId = "native-fixture.2.paste";
      expect(guests.context.choice).toBe("exclude");
      expect(h.calls).toHaveLength(0);
      expect(projectClipboard(guests)).toMatchObject({
        count: 1,
        intentId,
      });
      yield* send(h.actor, {
        choice: include ? "exclude" : "includeAndEmail",
        intentId: "stale-paste-intent",
        type: "GUESTS",
      });
      yield* send(h.actor, {
        choice: include ? "includeAndEmail" : "exclude",
        intentId,
        type: "GUESTS",
      });
      let priorFailure: typeof guests.context.failure;

      for (let attempt = 0; attempt < failures; attempt += 1) {
        const previousFailure = priorFailure;

        const failed = yield* waitClipboard(
          h.actor,
          (snapshot) =>
            snapshot.matches("creating") &&
            snapshot.context.creatorPhase === "failed" &&
            snapshot.context.failure !== previousFailure
        );

        expect(h.calls).toHaveLength(attempt + 1);
        expect(projectClipboard(failed)).toMatchObject({
          intentId,
          retryable: true,
        });
        priorFailure = failed.context.failure;
        yield* send(h.actor, { intentId, type: "RETRY" });
      }

      const completed = yield* waitClipboard(
        h.actor,
        (snapshot) =>
          snapshot.context.receipt !== undefined &&
          ClipboardReceipt.guards.Created(snapshot.context.receipt)
      );

      expect(completed.matches("ready")).toBe(true);
      expect(completed.context.envelope?.id).toBe(copy.envelope.id);
      expect(completed.context.pending).toBeUndefined();
      expect(h.calls).toHaveLength(failures + 1);
      expect(new Set(h.calls.map((call) => call.id)).size).toBe(1);
      expect(
        h.calls.every((call) => call.sendUpdates === (include ? "all" : "none"))
      ).toBe(true);
      expect(h.calls.at(-1)?.event.attendees).toHaveLength(include ? 1 : 0);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "cancelling a paste keeps the copied envelope and does not create",
  () =>
    Effect.gen(function* cancelPaste() {
      const h = yield* clipboardHarness(0);
      const copy = copiedFact(1, "copy");
      yield* send(h.actor, { notice: copy, type: "NATIVE" });
      yield* waitClipboard(
        h.actor,
        (snapshot) => snapshot.context.envelope?.id === copy.envelope.id
      );
      yield* send(h.actor, {
        notice: pasteFact(2, copy.envelope.id),
        type: "NATIVE",
      });
      yield* waitClipboard(h.actor, (snapshot) => snapshot.matches("guests"));
      yield* send(h.actor, { notice: copiedFact(3, "copy"), type: "NATIVE" });
      yield* send(h.actor, {
        intentId: "native-fixture.2.paste",
        type: "CANCEL",
      });

      const cancelled = yield* waitClipboard(
        h.actor,
        (snapshot) =>
          snapshot.matches("ready") && snapshot.context.pending === undefined
      );

      expect(cancelled.context.envelope?.id).toBe(copy.envelope.id);
      expect(h.calls).toHaveLength(0);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "deliberate later pastes get new creation identities while duplicate native delivery cannot create again",
  () =>
    Effect.gen(function* repeatedPastes() {
      const h = yield* clipboardHarness(0);
      const copy = copiedFact(1, "copy");
      yield* send(h.actor, { notice: copy, type: "NATIVE" });
      yield* waitClipboard(
        h.actor,
        (snapshot) => snapshot.context.envelope?.id === copy.envelope.id
      );

      for (const sequence of [2, 3]) {
        if (sequence === 3) {
          yield* send(h.actor, {
            notice: pasteFact(2, copy.envelope.id),
            type: "NATIVE",
          });
        }

        const intentId = `native-fixture.${sequence}.paste`;
        const paste = pasteFact(sequence, copy.envelope.id);
        yield* send(h.actor, { notice: paste, type: "NATIVE" });
        yield* waitClipboard(
          h.actor,
          (snapshot) =>
            snapshot.matches("guests") &&
            snapshot.context.pending?.intentId === intentId
        );
        yield* send(h.actor, { notice: paste, type: "NATIVE" });
        yield* send(h.actor, { choice: "exclude", intentId, type: "GUESTS" });
        yield* waitClipboard(
          h.actor,
          (snapshot) =>
            snapshot.context.receipt !== undefined &&
            ClipboardReceipt.guards.Created(snapshot.context.receipt) &&
            snapshot.context.receipt.intentId === intentId
        );
      }

      expect(h.calls).toHaveLength(2);
      expect(new Set(h.calls.map((call) => call.id)).size).toBe(2);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "an incomplete guest list is explicit even with no known guests and is never silently invited",
  { include: Schema.Boolean },
  ({ include }) =>
    Effect.gen(function* incompleteGuests() {
      const h = yield* clipboardHarness(0);
      const original = copiedFact(1, "copy");

      const item = ClipboardItem.make({
        ...original.envelope.items[0],
        guests: [],
        guestsComplete: false,
      });

      const copy = NativeClipboardNotice.cases.Copied.make({
        ...original,
        envelope: ClipboardEnvelope.make({
          ...original.envelope,
          items: [item],
        }),
      });

      yield* send(h.actor, { notice: copy, type: "NATIVE" });
      yield* waitClipboard(
        h.actor,
        (snapshot) => snapshot.context.envelope?.id === copy.envelope.id
      );
      yield* send(h.actor, {
        notice: pasteFact(2, copy.envelope.id),
        type: "NATIVE",
      });

      const guests = yield* waitClipboard(h.actor, (snapshot) =>
        snapshot.matches("guests")
      );

      expect(projectClipboard(guests)).toMatchObject({
        complete: false,
        count: 0,
      });
      expect(h.calls).toHaveLength(0);
      yield* send(h.actor, {
        choice: include ? "includeAndEmail" : "exclude",
        intentId: "native-fixture.2.paste",
        type: "GUESTS",
      });
      yield* waitClipboard(
        h.actor,
        (snapshot) =>
          snapshot.matches("ready") && snapshot.context.pending === undefined
      );
      expect(h.calls).toHaveLength(include ? 0 : 1);
      expect(h.calls.at(-1)?.sendUpdates).toBe(include ? undefined : "none");
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "a read-only destination refuses before any provider call and never falls back to the source calendar",
  () =>
    Effect.gen(function* readOnlyTarget() {
      const h = yield* clipboardHarness(0);
      const copy = copiedFact(1, "copy");
      yield* send(h.actor, { notice: copy, type: "NATIVE" });
      yield* waitClipboard(
        h.actor,
        (snapshot) => snapshot.context.envelope?.id === copy.envelope.id
      );
      const paste = pasteFact(2, copy.envelope.id);

      const target = ClipboardPasteTarget.make({
        ...paste.target,
        calendar: { ...paste.target.calendar, accessRole: "reader" },
      });

      yield* send(h.actor, {
        notice: NativeClipboardNotice.cases.Paste.make({ ...paste, target }),
        type: "NATIVE",
      });

      const refused = yield* waitClipboard(
        h.actor,
        (snapshot) =>
          snapshot.matches("ready") &&
          snapshot.context.lastNativeSequence === 2 &&
          snapshot.context.pending === undefined
      );

      expect(refused.context.envelope?.id).toBe(copy.envelope.id);
      expect(h.calls).toHaveLength(0);
    }).pipe(Effect.provide(NodeServices.layer))
);
