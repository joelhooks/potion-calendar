import { Option, Schema } from "effect";

export const MinuteRange = Schema.Struct({
  endMinute: Schema.Int.check(Schema.isBetween({ maximum: 1440, minimum: 1 })),
  startMinute: Schema.Int.check(
    Schema.isBetween({ maximum: 1439, minimum: 0 })
  ),
}).check(Schema.makeFilter((range) => range.startMinute < range.endMinute));

export const TimeBlock = Schema.Struct({
  color: Schema.String.check(Schema.isPattern(/^#[\da-f]{6}$/iu)),
  hidden: Schema.Boolean,
  id: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  name: Schema.NonEmptyString.check(
    Schema.makeFilter((value) => value.trim().length > 0)
  ),
  ranges: Schema.Array(MinuteRange).check(Schema.isMinLength(1)),
});

export const TimeBlockPreferences = Schema.Struct({
  blocks: Schema.Array(TimeBlock).check(
    Schema.makeFilter(
      (blocks) =>
        new Set(blocks.map((block) => block.id)).size === blocks.length
    )
  ),
  enabled: Schema.Boolean,
});

export const emptyTimeBlocks = (): typeof TimeBlockPreferences.Type => ({
  blocks: [],
  enabled: false,
});

export const mergeMinuteRanges = (
  ranges: readonly (typeof MinuteRange.Type)[]
): readonly (typeof MinuteRange.Type)[] => {
  const merged: (typeof MinuteRange.Type)[] = [];

  for (const range of ranges.toSorted(
    (left, right) =>
      left.startMinute - right.startMinute || left.endMinute - right.endMinute
  )) {
    const previous = merged.at(-1);

    if (previous !== undefined && range.startMinute <= previous.endMinute) {
      merged.pop();
      merged.push({
        endMinute: Math.max(previous.endMinute, range.endMinute),
        startMinute: previous.startMinute,
      });
    } else {
      merged.push(range);
    }
  }

  return merged;
};

export const mergeHiddenRanges = (
  blocks: readonly (typeof TimeBlock.Type)[]
): readonly (typeof MinuteRange.Type)[] =>
  mergeMinuteRanges(
    blocks.filter((block) => block.hidden).flatMap((block) => block.ranges)
  );

export const activeTimeBlocks = (
  preferences: typeof TimeBlockPreferences.Type
): readonly (typeof TimeBlock.Type)[] =>
  preferences.enabled ? preferences.blocks : [];

export const blockClock = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const Clock = Schema.String.check(
  Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
);

export const blockMinute = (
  text: string,
  end: boolean
): Option.Option<number> => {
  if (end && text === "24:00") {
    return Option.some(1440);
  }

  return Schema.decodeOption(Clock)(text).pipe(
    Option.map((value) => {
      const [hour = "0", minute = "0"] = value.split(":");

      return Number(hour) * 60 + Number(minute);
    })
  );
};
