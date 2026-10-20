import { CalendarEvent } from "@calendar/calendar/contracts";
import { Schema } from "effect";

import { captureClipboardItem } from "../client/clipboard/capture.js";
import {
  ClipboardCaptureResult,
  ClipboardItem,
} from "../client/clipboard/model.js";
import type { SelectionSet } from "./selection-set.js";

export const SelectionClipboardCandidate = Schema.Struct({
  event: CalendarEvent,
  key: Schema.NonEmptyString,
});

export const SelectionClipboardMember = Schema.Struct({
  item: ClipboardItem,
  key: Schema.NonEmptyString,
});

export const SelectionClipboardIssue = Schema.Struct({
  key: Schema.String,
  message: Schema.String,
  reason: Schema.Literals([
    "emptySelection",
    "missingSource",
    "ambiguousSource",
    "duplicateSource",
    "unsupportedSource",
  ]),
  title: Schema.String,
});

export const SelectionClipboardSnapshot = Schema.Struct({
  copyId: Schema.NonEmptyString,
  members: Schema.NonEmptyArray(SelectionClipboardMember),
  personId: Schema.NonEmptyString,
  version: Schema.Literal(1),
});

export const SelectionClipboardCapture = Schema.TaggedUnion({
  Captured: { snapshot: SelectionClipboardSnapshot },
  Refused: { issues: Schema.NonEmptyArray(SelectionClipboardIssue) },
});

export const captureSelectionClipboard = (input: {
  readonly candidates: readonly (typeof SelectionClipboardCandidate.Type)[];
  readonly copyId: string;
  readonly personId: string;
  readonly selection: typeof SelectionSet.Type;
  readonly selfEmails: readonly string[];
}): typeof SelectionClipboardCapture.Type => {
  const members: (typeof SelectionClipboardMember.Type)[] = [];
  const issues: (typeof SelectionClipboardIssue.Type)[] = [];
  const sources = new Set<string>();

  for (const key of input.selection) {
    const candidates = input.candidates.filter(
      (candidate) => candidate.key === key
    );

    const [candidate] = candidates;

    if (candidate === undefined || candidates.length !== 1) {
      issues.push({
        key,
        message:
          candidate === undefined
            ? "The selected event is no longer available."
            : "The selection does not identify one saved provider event.",
        reason: candidate === undefined ? "missingSource" : "ambiguousSource",
        title: candidate?.event.title ?? "Event",
      });
      continue;
    }

    const captured = captureClipboardItem(candidate.event, input.selfEmails);

    if (ClipboardCaptureResult.guards.Refused(captured)) {
      issues.push({
        key,
        message: captured.failure.message,
        reason: "unsupportedSource",
        title: candidate.event.title ?? "Event",
      });
      continue;
    }

    const { source } = captured.item;

    const identity = JSON.stringify([
      source.accountId,
      source.calendarId,
      source.eventId,
    ]);

    if (sources.has(identity)) {
      issues.push({
        key,
        message:
          "This provider event is already included in the copied selection.",
        reason: "duplicateSource",
        title: candidate.event.title ?? "Event",
      });
      continue;
    }

    sources.add(identity);

    const item = ClipboardItem.make({
      ...captured.item,
      content: {
        ...captured.item.content,
        reminders: {
          ...captured.item.content.reminders,
          overrides: captured.item.content.reminders.overrides.map(
            (reminder) => ({ ...reminder })
          ),
        },
      },
    });

    members.push({ item, key });
  }

  const [firstIssue, ...otherIssues] = issues;

  if (firstIssue !== undefined) {
    return SelectionClipboardCapture.cases.Refused.make({
      issues: [firstIssue, ...otherIssues],
    });
  }

  const [first, ...rest] = members;

  if (first === undefined) {
    return SelectionClipboardCapture.cases.Refused.make({
      issues: [
        {
          key: "",
          message: "Select at least one event before copying.",
          reason: "emptySelection",
          title: "Selection",
        },
      ],
    });
  }

  return SelectionClipboardCapture.cases.Captured.make({
    snapshot: {
      copyId: input.copyId,
      members: [first, ...rest],
      personId: input.personId,
      version: 1,
    },
  });
};
