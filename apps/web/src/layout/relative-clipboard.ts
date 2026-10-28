import { DateTime, Effect, Option, Result, Schema } from "effect";

import {
  ClipboardAnchor,
  ClipboardInputFailure,
  ClipboardRange,
} from "../client/clipboard/model.js";
import type { ClipboardRefusalPresentation } from "../client/clipboard/model.js";
import { placeClipboardItem } from "../client/clipboard/placement.js";
import {
  clipboardLocalCoordinates as localCoordinates,
  clipboardUniqueLocalInstant as uniqueLocalInstant,
  clipboardLocalTimeExplanation as describeUnsafeLocalTime,
  shiftClipboardTimedDates,
} from "./clipboard-time.js";
import { editorDate } from "./editor-time.js";
import { requireEditorZone } from "./editor-zone.js";
import type { SelectionClipboardSnapshot } from "./selection-clipboard.js";
import { SelectionClipboardMember } from "./selection-clipboard.js";

export const RelativeClipboardPlacement = Schema.Struct({
  allDay: Schema.Boolean,
  endDate: Schema.String,
  endTime: Schema.String,
  startDate: Schema.String,
  startTime: Schema.String,
  timeZone: Schema.String,
});

export const RelativeClipboardIssue = Schema.Struct({
  key: Schema.String,
  message: Schema.String,
  reason: Schema.Literals([
    "ownerMismatch",
    "mixedRanges",
    "missingTime",
    "invalidZone",
    "invalidRange",
    "unsafeLocalTime",
  ]),
  title: Schema.String,
});

export const RelativeClipboardStep = Schema.Struct({
  ...SelectionClipboardMember.fields,
  placement: RelativeClipboardPlacement,
});

export const RelativeClipboardPlan = Schema.TaggedUnion({
  Planned: {
    anchorKey: Schema.NonEmptyString,
    copyId: Schema.NonEmptyString,
    issues: Schema.Array(RelativeClipboardIssue),
    personId: Schema.NonEmptyString,
    steps: Schema.Array(RelativeClipboardStep),
  },
  Refused: { issues: Schema.NonEmptyArray(RelativeClipboardIssue) },
});

const issue = (
  member: typeof SelectionClipboardMember.Type,
  reason: (typeof RelativeClipboardIssue.Type)["reason"],
  message: string
) =>
  RelativeClipboardIssue.make({
    key: member.key,
    message,
    reason,
    title: member.item.content.title,
  });

const dateCoordinates = (date: string) =>
  editorDate(date).pipe(Option.map(DateTime.toEpochMillis));

const validStart = (member: typeof SelectionClipboardMember.Type) =>
  ClipboardRange.match(member.item.range, {
    AllDay: ({ end, start }) =>
      Option.all([dateCoordinates(start), dateCoordinates(end)]).pipe(
        Option.filter(([from, to]) => to > from),
        Option.map(([from]) => from)
      ),
    Timed: ({ end, start }) =>
      Number.isFinite(start) && Number.isFinite(end) && end > start
        ? Option.some(start)
        : Option.none(),
  });

const earliestMember = (
  members: (typeof SelectionClipboardSnapshot.Type)["members"]
) => {
  const [first, ...rest] = members;

  let earliest = first;

  for (const member of rest) {
    if (
      Option.getOrElse(validStart(member), () => Infinity) <
      Option.getOrElse(validStart(earliest), () => Infinity)
    ) {
      earliest = member;
    }
  }

  return earliest;
};

const describeShiftFailure = (
  member: typeof SelectionClipboardMember.Type,
  delta: number,
  zone: string,
  refusalPresentation?: typeof ClipboardRefusalPresentation.Type
) => {
  if (!ClipboardRange.guards.Timed(member.item.range)) {
    return `${member.item.content.title} would land outside the supported date range. Choose another target.`;
  }

  const coordinates = localCoordinates(member.item.range.start, zone);

  if (Option.isNone(coordinates)) {
    return `${member.item.content.title} has no supported home-zone coordinates. Choose another target.`;
  }

  const start = coordinates.value + delta;
  const instant = uniqueLocalInstant(start, zone);

  const explanation = Option.isNone(instant)
    ? describeUnsafeLocalTime(
        start,
        zone,
        "start",
        member.item.content.title,
        refusalPresentation
      )
    : localCoordinates(
        instant.value + member.item.range.end - member.item.range.start,
        zone
      ).pipe(
        Option.flatMap((end) =>
          describeUnsafeLocalTime(
            end,
            zone,
            "end",
            member.item.content.title,
            refusalPresentation
          )
        )
      );

  return Option.getOrElse(
    explanation,
    () =>
      `${member.item.content.title} cannot be represented safely in the home zone. Choose another target.`
  );
};

const shiftedTimedAnchor = (
  member: typeof SelectionClipboardMember.Type,
  delta: number,
  zone: string
): Option.Option<typeof ClipboardAnchor.Type> => {
  if (!ClipboardRange.guards.Timed(member.item.range)) {
    return Option.none();
  }

  const duration = member.item.range.end - member.item.range.start;

  return localCoordinates(member.item.range.start, zone).pipe(
    Option.flatMap((start) => uniqueLocalInstant(start + delta, zone)),
    Option.filter((start) => {
      const end = start + duration;

      return localCoordinates(end, zone).pipe(
        Option.flatMap((coordinates) => uniqueLocalInstant(coordinates, zone)),
        Option.contains(end)
      );
    }),
    Option.map((instant) =>
      ClipboardAnchor.cases.Timed.make({
        date: DateTime.makeZonedUnsafe(instant, { timeZone: zone }).pipe(
          DateTime.formatIsoDate
        ),
        instant,
      })
    )
  );
};

const shiftedDateAnchor = (
  member: typeof SelectionClipboardMember.Type,
  delta: number
): Option.Option<typeof ClipboardAnchor.Type> =>
  ClipboardRange.guards.AllDay(member.item.range)
    ? dateCoordinates(member.item.range.start).pipe(
        Option.flatMap((start) => DateTime.make(start + delta)),
        Option.map((start) =>
          ClipboardAnchor.cases.AllDay.make({
            date: DateTime.formatIsoDateUtc(start),
          })
        )
      )
    : Option.none();

const placeRelativeMember = Effect.fn("placeRelativeClipboardMember")(
  function* placeRelativeMember(
    member: typeof SelectionClipboardMember.Type,
    delta: number,
    zone: string,
    allDay: boolean,
    monthDate: boolean,
    refusalPresentation?: typeof ClipboardRefusalPresentation.Type
  ) {
    let { item } = member;
    let anchor: Option.Option<typeof ClipboardAnchor.Type>;

    if (monthDate && ClipboardRange.guards.Timed(item.range)) {
      const range = yield* shiftClipboardTimedDates({
        days: delta / 86_400_000,
        homeZone: zone,
        range: item.range,
        refusalPresentation,
        source: item.source,
        title: item.content.title,
      });

      item = { ...item, range };
      anchor = Option.some(
        ClipboardAnchor.cases.Timed.make({
          date: DateTime.makeZonedUnsafe(range.start, { timeZone: zone }).pipe(
            DateTime.formatIsoDate
          ),
          instant: range.start,
        })
      );
    } else {
      anchor = allDay
        ? shiftedDateAnchor(member, delta)
        : shiftedTimedAnchor(member, delta, zone);
    }

    const target = yield* Effect.fromOption(anchor).pipe(
      Effect.mapError(
        () =>
          new ClipboardInputFailure({
            message: describeShiftFailure(
              member,
              delta,
              zone,
              refusalPresentation
            ),
            reason: "ambiguousTime",
            source: item.source,
          })
      )
    );

    return yield* placeClipboardItem(
      item,
      target,
      zone,
      refusalPresentation
    ).pipe(
      Effect.mapError(
        (failure) =>
          new ClipboardInputFailure({
            message: `${member.item.content.title}: ${failure.message}`,
            reason: failure.reason,
            source: member.item.source,
          })
      )
    );
  }
);

export const planRelativeClipboard = Effect.fn("planRelativeClipboard")(
  function* planRelativeClipboard(input: {
    readonly anchor: typeof ClipboardAnchor.Type;
    readonly homeZone: string;
    readonly personId: string;
    readonly refusalPresentation?:
      | typeof ClipboardRefusalPresentation.Type
      | undefined;
    readonly snapshot: typeof SelectionClipboardSnapshot.Type;
  }): Effect.fn.Return<typeof RelativeClipboardPlan.Type> {
    const { snapshot } = input;
    const [first] = snapshot.members;

    const refuse = (
      reason: (typeof RelativeClipboardIssue.Type)["reason"],
      message: string
    ) =>
      RelativeClipboardPlan.cases.Refused.make({
        issues: [issue(first, reason, message)],
      });

    if (snapshot.personId !== input.personId) {
      return refuse(
        "ownerMismatch",
        "This copied selection belongs to another signed-in person."
      );
    }

    const allDay = ClipboardRange.guards.AllDay(first.item.range);

    if (
      snapshot.members.some(
        (member) => ClipboardRange.guards.AllDay(member.item.range) !== allDay
      )
    ) {
      return refuse(
        "mixedRanges",
        "Timed and all-day events cannot be pasted together in this version. Copy one kind at a time."
      );
    }

    const invalid = snapshot.members
      .filter((member) => Option.isNone(validStart(member)))
      .map((member) =>
        issue(
          member,
          "invalidRange",
          "This copied event has no valid positive range."
        )
      );

    const [invalidFirst, ...invalidRest] = invalid;

    if (invalidFirst !== undefined) {
      return RelativeClipboardPlan.cases.Refused.make({
        issues: [invalidFirst, ...invalidRest],
      });
    }

    const monthDate =
      !allDay &&
      ClipboardAnchor.guards.AllDay(input.anchor) &&
      input.anchor.origin === "month";

    if (!allDay && ClipboardAnchor.guards.AllDay(input.anchor) && !monthDate) {
      return refuse(
        "missingTime",
        "Choose a time slot before pasting timed events."
      );
    }

    const zone = yield* requireEditorZone(input.homeZone).pipe(Effect.option);

    if (Option.isNone(zone)) {
      return refuse(
        "invalidZone",
        "Choose a supported home time zone before pasting this selection."
      );
    }

    const earliest = earliestMember(snapshot.members);
    const start = validStart(earliest);

    const timedTarget = ClipboardAnchor.match(input.anchor, {
      AllDay: () => Option.none<number>(),
      Timed: ({ instant }) => localCoordinates(instant, zone.value),
    });

    const target =
      allDay || monthDate ? dateCoordinates(input.anchor.date) : timedTarget;

    const origin = start.pipe(
      Option.flatMap((instant) => {
        if (allDay) {
          return Option.some(instant);
        }

        if (monthDate) {
          return DateTime.makeZoned(instant, { timeZone: zone.value }).pipe(
            Option.map(DateTime.formatIsoDate),
            Option.flatMap(dateCoordinates)
          );
        }

        return localCoordinates(instant, zone.value);
      })
    );

    if (Option.isNone(target) || Option.isNone(origin)) {
      return refuse(
        "invalidRange",
        "The group origin or target has no supported calendar coordinates."
      );
    }

    const delta = target.value - origin.value;
    const steps: (typeof RelativeClipboardStep.Type)[] = [];
    const issues: (typeof RelativeClipboardIssue.Type)[] = [];

    for (const member of snapshot.members) {
      const placed = yield* placeRelativeMember(
        member,
        delta,
        zone.value,
        allDay,
        monthDate,
        input.refusalPresentation
      ).pipe(Effect.result);

      if (Result.isFailure(placed)) {
        issues.push(issue(member, "unsafeLocalTime", placed.failure.message));
      } else {
        steps.push({ ...member, placement: placed.success });
      }
    }

    return RelativeClipboardPlan.cases.Planned.make({
      anchorKey: earliest.key,
      copyId: snapshot.copyId,
      issues,
      personId: snapshot.personId,
      steps,
    });
  }
);
