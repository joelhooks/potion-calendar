import { expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";

import {
  ClipboardDelivery,
  receiveClipboardDelivery,
} from "../src/client/clipboard/delivery.js";
import { ClipboardReceipt } from "../src/client/clipboard/machine.js";
import {
  ClipboardView,
  initialClipboard,
  initialClipboardView,
  resetClipboardScope,
} from "../src/client/clipboard/model.js";
import { ClipboardNotice } from "../src/client/clipboard/runtime.js";
import { clipboardSource } from "./clipboard-fixture.js";

const stateNotice = (epoch: number, personId: string, sessionId: string) =>
  ClipboardDelivery.make({
    epoch,
    notice: ClipboardNotice.cases.State.make({ view: initialClipboardView }),
    personId,
    sessionId,
  });

const cutNotice = (
  epoch: number,
  personId: string,
  sessionId: string,
  revision: number
) =>
  ClipboardDelivery.make({
    epoch,
    notice: ClipboardNotice.cases.Receipt.make({
      receipt: ClipboardReceipt.cases.Cut.make({
        copyId: `copy-${revision}`,
        id: `cut-${revision}`,
        revision,
        source: {
          accountId: clipboardSource.accountId,
          calendarId: clipboardSource.calendarId,
          eventId: clipboardSource.eventId,
        },
      }),
    }),
    personId,
    sessionId,
  });

it.prop(
  "duplicate and reordered deletion receipts never repeat or move the consumed cursor backwards",
  {
    revisions: Schema.Array(
      Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(1),
        Schema.isLessThanOrEqualTo(8)
      )
    ).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  },
  ({ revisions }) => {
    const person = Option.some("person-A");

    let { state } = receiveClipboardDelivery(
      initialClipboard,
      person,
      stateNotice(0, "person-A", "session-A")
    );

    const performed = new Set<number>();
    let greatest = 0;

    for (const revision of revisions) {
      const delivery = cutNotice(0, "person-A", "session-A", revision);
      const result = receiveClipboardDelivery(state, person, delivery);
      expect(Option.isSome(result.receipt)).toBe(revision > greatest);

      if (Option.isSome(result.receipt)) {
        expect(performed.has(revision)).toBe(false);
        performed.add(revision);
      }

      greatest = Math.max(greatest, revision);
      ({ state } = result);
      expect(state.receiptRevision).toBe(greatest);
    }
  }
);

it("a person round trip cannot revive old UI state or deletion receipts from the earlier session", () => {
  const a = Option.some("person-A");

  const firstA = receiveClipboardDelivery(
    initialClipboard,
    a,
    stateNotice(0, "person-A", "session-A-old")
  ).state;

  const b = resetClipboardScope(firstA);

  const boundB = receiveClipboardDelivery(
    b,
    Option.some("person-B"),
    stateNotice(1, "person-B", "session-B")
  ).state;

  const nextA = resetClipboardScope(boundB);
  expect(
    receiveClipboardDelivery(
      nextA,
      a,
      stateNotice(0, "person-A", "session-A-old")
    ).accepted
  ).toBe(false);

  const boundA = receiveClipboardDelivery(
    nextA,
    a,
    stateNotice(2, "person-A", "session-A-new")
  ).state;

  const oldReceipt = receiveClipboardDelivery(
    boundA,
    a,
    cutNotice(0, "person-A", "session-A-old", 1)
  );

  expect(oldReceipt.accepted).toBe(false);
  expect(Option.isNone(oldReceipt.receipt)).toBe(true);
  expect(oldReceipt.state).toBe(boundA);
  expect(
    receiveClipboardDelivery(
      boundA,
      a,
      stateNotice(0, "person-A", "session-A-old")
    ).accepted
  ).toBe(false);
  expect(
    receiveClipboardDelivery(
      boundA,
      a,
      stateNotice(2, "person-A", "session-A-old")
    ).accepted
  ).toBe(false);
});

it("only a matching first state binds the UI lease; receipts and foreign copy identities cannot bind it", () => {
  const person = Option.some("person-A");
  expect(
    receiveClipboardDelivery(
      initialClipboard,
      person,
      cutNotice(0, "person-A", "session-A", 1)
    ).accepted
  ).toBe(false);

  const foreign = ClipboardDelivery.make({
    epoch: 0,
    notice: ClipboardNotice.cases.State.make({
      view: ClipboardView.cases.Idle.make({
        copied: Option.some({ id: "foreign-copy", personId: "person-B" }),
        toast: Option.none(),
      }),
    }),
    personId: "person-A",
    sessionId: "session-A",
  });

  const refused = receiveClipboardDelivery(initialClipboard, person, foreign);
  expect(refused.accepted).toBe(false);
  expect(Option.isNone(refused.state.sessionId)).toBe(true);
});
