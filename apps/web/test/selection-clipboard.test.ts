import { CalendarEvent } from "@calendar/calendar/contracts";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  captureSelectionClipboard,
  SelectionClipboardCapture,
} from "../src/layout/selection-clipboard.js";
import { clipboardSource } from "./clipboard-fixture.js";

it.prop(
  "capture follows selection order rather than candidate order, keeps exact provider references and strips self identity from guests",
  {
    accounts: Schema.Array(
      Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(8)
      )
    ).check(Schema.isUnique(), Schema.isMinLength(1), Schema.isMaxLength(8)),
    reversed: Schema.Boolean,
  },
  ({ reversed, accounts }) => {
    const candidates = accounts.map((account) => ({
      event: CalendarEvent.make({
        ...clipboardSource,
        accountId: `account-${account}`,
        eventId: "same-event-id",
      }),
      key: `key-${account}`,
    }));

    const selection = candidates.map((candidate) => candidate.key);

    const result = captureSelectionClipboard({
      candidates: reversed ? candidates.toReversed() : candidates,
      copyId: "owned-copy",
      personId: "person-A",
      selection,
      selfEmails: ["owner@example.test"],
    });

    if (!SelectionClipboardCapture.guards.Captured(result)) {
      throw new Error("Valid selection refused");
    }

    expect(result.snapshot.members.map((member) => member.key)).toEqual(
      selection
    );
    expect(
      result.snapshot.members.map((member) => member.item.source.accountId)
    ).toEqual(accounts.map((account) => `account-${account}`));
    expect(
      result.snapshot.members.every((member) =>
        member.item.guests.every((guest) => guest.email === "alex@example.test")
      )
    ).toBe(true);
    expect(result.snapshot.personId).toBe("person-A");
    const encoded = JSON.stringify(result.snapshot);
    expect(encoded).not.toContain("native-private");
    expect(encoded).not.toContain("provider-only");
  }
);

it("capture accumulates independent missing, ambiguous, duplicate and unsupported sources without silently shrinking the selected group", () => {
  const candidate = { event: clipboardSource, key: "valid" };

  const result = captureSelectionClipboard({
    candidates: [
      candidate,
      { ...candidate, key: "duplicate" },
      { ...candidate, key: "ambiguous" },
      { ...candidate, key: "ambiguous" },
      {
        event: CalendarEvent.make({
          ...clipboardSource,
          eventType: "outOfOffice",
        }),
        key: "unsupported",
      },
    ],
    copyId: "owned-copy",
    personId: "person-A",
    selection: ["valid", "missing", "ambiguous", "duplicate", "unsupported"],
    selfEmails: [],
  });

  if (!SelectionClipboardCapture.guards.Refused(result)) {
    throw new Error("Incomplete capture should refuse");
  }

  expect(result.issues.map((issue) => issue.reason)).toEqual([
    "missingSource",
    "ambiguousSource",
    "duplicateSource",
    "unsupportedSource",
  ]);
  expect(result.issues.map((issue) => issue.key)).toEqual([
    "missing",
    "ambiguous",
    "duplicate",
    "unsupported",
  ]);
});

it("captured reminder policy does not alias a later-mutated candidate reminder list", () => {
  const reminder = { method: "popup", minutes: 10 } satisfies {
    method: "popup";
    minutes: number;
  };

  const overrides = [reminder];

  const source = CalendarEvent.make({
    ...clipboardSource,
    reminders: { overrides, useDefault: false },
  });

  const result = captureSelectionClipboard({
    candidates: [{ event: source, key: "event" }],
    copyId: "owned-copy",
    personId: "person-A",
    selection: ["event"],
    selfEmails: [],
  });

  if (!SelectionClipboardCapture.guards.Captured(result)) {
    throw new Error("Valid capture refused");
  }

  reminder.minutes = 60;
  overrides.push({ method: "popup", minutes: 120 });
  expect(result.snapshot.members[0].item.content.reminders).toEqual({
    overrides: [{ method: "popup", minutes: 10 }],
    useDefault: false,
  });
});

it("the empty selection refuses instead of producing a marker-ready snapshot", () => {
  const result = captureSelectionClipboard({
    candidates: [],
    copyId: "owned-copy",
    personId: "person-A",
    selection: [],
    selfEmails: [],
  });

  expect(
    SelectionClipboardCapture.guards.Refused(result) && result.issues[0]?.reason
  ).toBe("emptySelection");
});
