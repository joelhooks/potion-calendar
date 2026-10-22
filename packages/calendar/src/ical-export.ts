import { DateTime, Option, Schema } from "effect";

import { escapeIcsText, foldIcsLine } from "./ical-text.js";
import { EventRef } from "./model.js";
import type { CalendarEventValue, EventTimeValue } from "./model.js";

export const IcsSkippedEvent = Schema.Struct({
  event: EventRef,
  reason: Schema.Literal("zonedRecurringMaster"),
});

const IcsRefusal = Schema.Literals([
  "emptySelection",
  "invalidTime",
  "invalidValue",
  "unsupportedRecurrence",
  "zonedRecurringMaster",
]);

export const IcsExportOutcome = Schema.TaggedUnion({
  Ready: {
    content: Schema.String,
    eventCount: Schema.Int,
    filename: Schema.String,
    skipped: Schema.Array(IcsSkippedEvent),
  },
  Refused: { reason: IcsRefusal, skipped: Schema.Array(IcsSkippedEvent) },
});

const IcsComponent = Schema.TaggedUnion({
  Ready: { lines: Schema.Array(Schema.String) },
  Refused: { reason: IcsRefusal },
  Skipped: {},
});

interface TimeValue {
  readonly date: boolean;
  readonly epoch: number;
  readonly value: string;
}

const textValue = Schema.String.check(
  Schema.isPattern(/^[\t\n\r\u0020-\u007E\u0080-\u{10FFFF}]*$/u)
);

const ruleValue = Schema.String.check(
  Schema.isPattern(/^RRULE:[A-Z0-9=;,+-]+$/iu)
);

const utf8Encoder = new TextEncoder();

const utf8Decoder = new TextDecoder();

const utcValue = (value: DateTime.DateTime): string =>
  `${DateTime.formatIso(value).slice(0, 19).replaceAll("-", "").replaceAll(":", "")}Z`;

const timeValue = (
  value: EventTimeValue | undefined
): Option.Option<TimeValue> => {
  if (value === undefined) {
    return Option.none();
  }

  const original = "date" in value ? value.date : value.dateTime;
  const parsed = DateTime.make(original);

  if (Option.isNone(parsed)) {
    return Option.none();
  }

  const epoch = DateTime.toEpochMillis(parsed.value);

  if ("date" in value) {
    return DateTime.formatIsoDateUtc(parsed.value) === value.date
      ? Option.some({
          date: true,
          epoch,
          value: value.date.replaceAll("-", ""),
        })
      : Option.none();
  }

  return epoch % 1000 === 0
    ? Option.some({ date: false, epoch, value: utcValue(parsed.value) })
    : Option.none();
};

const timeLine = (name: string, value: TimeValue): string =>
  `${name}${value.date ? ";VALUE=DATE" : ""}:${value.value}`;

const httpLink = (value: string | undefined): string | undefined => {
  if (value === undefined || value.includes("\\") || !URL.canParse(value)) {
    return undefined;
  }

  for (const point of value) {
    const code = point.codePointAt(0) ?? 0;

    if (code <= 32 || code === 127) {
      return undefined;
    }
  }

  const url = new URL(value);

  return (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === ""
    ? url.href
    : undefined;
};

const calendarAddress = (email: string): string =>
  `mailto:${encodeURIComponent(email).replaceAll("%40", "@")}`;

const utcMaster = (event: CalendarEventValue): boolean => {
  const { start } = event;

  if (start === undefined || "date" in start) {
    return true;
  }

  return start.timeZone === undefined
    ? /(?:Z|[+-]00:00)$/u.test(start.dateTime)
    : ["UTC", "ETC/UTC", "GMT", "ETC/GMT"].includes(
        start.timeZone.toUpperCase()
      );
};

const timeLines = (
  event: CalendarEventValue,
  occurrence: boolean
): Option.Option<readonly string[]> => {
  const start = timeValue(event.start);
  const end = timeValue(event.end);
  const original = timeValue(event.originalStartTime);

  if (
    Option.isNone(start) ||
    Option.isNone(end) ||
    start.value.date !== end.value.date ||
    end.value.epoch <= start.value.epoch
  ) {
    return Option.none();
  }

  if (
    occurrence &&
    (Option.isNone(original) || original.value.date !== start.value.date)
  ) {
    return Option.none();
  }

  return Option.some([
    timeLine("DTSTART", start.value),
    timeLine("DTEND", end.value),
    ...(occurrence && Option.isSome(original)
      ? [timeLine("RECURRENCE-ID", original.value)]
      : []),
  ]);
};

const validEventText = (event: CalendarEventValue, uid: string): boolean => {
  const values = [
    uid,
    event.title ?? "",
    event.description ?? "",
    event.location ?? "",
    event.organizer?.email ?? "",
    ...(event.attendees ?? []).map((attendee) => attendee.email),
  ];

  return (
    values.every(
      (value) =>
        utf8Decoder.decode(utf8Encoder.encode(value)) === value &&
        Schema.is(textValue)(value)
    ) &&
    (event.attendees ?? []).every(
      (attendee) => attendee.email.trim().length > 0
    )
  );
};

const detailLines = (event: CalendarEventValue): readonly string[] => {
  const lines: string[] = [];

  for (const [name, value] of [
    ["DESCRIPTION", event.description],
    ["LOCATION", event.location],
  ] as const) {
    if (value !== undefined) {
      lines.push(`${name}:${escapeIcsText(value)}`);
    }
  }

  const link = httpLink(event.htmlLink);

  if (link !== undefined) {
    lines.push(`URL:${link}`);
  }

  const email = event.organizer?.email;

  if (email !== undefined && email.length > 0) {
    lines.push(`ORGANIZER:${calendarAddress(email)}`);
  }

  for (const attendee of event.attendees ?? []) {
    const status = {
      accepted: "ACCEPTED",
      declined: "DECLINED",
      needsAction: "NEEDS-ACTION",
      tentative: "TENTATIVE",
    }[attendee.responseStatus ?? "needsAction"];

    lines.push(
      `ATTENDEE;PARTSTAT=${status}:${calendarAddress(attendee.email)}`
    );
  }

  return lines;
};

const componentLines = (
  event: CalendarEventValue,
  stamp: DateTime.Utc
): typeof IcsComponent.Type => {
  const occurrence =
    event.recurringEventId !== undefined ||
    event.originalStartTime !== undefined;

  const recurrence = occurrence ? [] : (event.recurrence ?? []);

  if (recurrence.some((line) => /^RRULE:/iu.test(line)) && !utcMaster(event)) {
    return IcsComponent.cases.Skipped.make({});
  }

  if (
    recurrence.length > 1 ||
    recurrence.some((line) => !Schema.is(ruleValue)(line))
  ) {
    return IcsComponent.cases.Refused.make({ reason: "unsupportedRecurrence" });
  }

  const times = timeLines(event, occurrence);

  if (Option.isNone(times)) {
    return IcsComponent.cases.Refused.make({ reason: "invalidTime" });
  }

  const uid =
    (event.iCalUID?.trim().length ?? 0) > 0
      ? (event.iCalUID ?? "")
      : `${event.eventId}-calendar-export`;

  if (!validEventText(event, uid)) {
    return IcsComponent.cases.Refused.make({ reason: "invalidValue" });
  }

  return IcsComponent.cases.Ready.make({
    lines: [
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(uid)}`,
      `DTSTAMP:${utcValue(stamp)}`,
      ...times.value,
      `SUMMARY:${escapeIcsText(event.title ?? "")}`,
      ...detailLines(event),
      ...recurrence,
      "END:VEVENT",
    ],
  });
};

export const icsFilename = (events: readonly CalendarEventValue[]): string => {
  const title = events.length === 1 ? (events[0]?.title ?? "") : "";

  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

  return `${slug || "events"}.ics`;
};

export const exportIcsCalendar = (
  events: readonly CalendarEventValue[],
  stamp: DateTime.Utc
): typeof IcsExportOutcome.Type => {
  const skipped: (typeof IcsSkippedEvent.Type)[] = [];
  const components: string[] = [];
  let count = 0;

  for (const event of events) {
    const component = componentLines(event, stamp);

    if (IcsComponent.guards.Skipped(component)) {
      skipped.push({
        event: {
          accountId: event.accountId,
          calendarId: event.calendarId,
          eventId: event.eventId,
        },
        reason: "zonedRecurringMaster",
      });
    } else if (IcsComponent.guards.Refused(component)) {
      return IcsExportOutcome.cases.Refused.make({
        reason: component.reason,
        skipped,
      });
    } else {
      components.push(...component.lines);
      count += 1;
    }
  }

  if (count === 0) {
    return IcsExportOutcome.cases.Refused.make({
      reason: skipped.length > 0 ? "zonedRecurringMaster" : "emptySelection",
      skipped,
    });
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Calendar//Selected event export//EN",
    ...components,
    "END:VCALENDAR",
  ];

  return IcsExportOutcome.cases.Ready.make({
    content: `${lines.map(foldIcsLine).join("\r\n")}\r\n`,
    eventCount: count,
    filename: icsFilename(events),
    skipped,
  });
};
