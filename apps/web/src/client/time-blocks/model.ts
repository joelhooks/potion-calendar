import { Option, Schema } from "effect";

import {
  TimeBlock,
  blockClock,
  blockMinute,
} from "../../layout/time-blocks.js";

export const TimeBlockDraft = Schema.Struct({
  color: Schema.String,
  hidden: Schema.Boolean,
  id: Schema.Int,
  name: Schema.String,
  original: Schema.Option(TimeBlock),
  ranges: Schema.Array(
    Schema.Struct({ end: Schema.String, start: Schema.String })
  ),
});

interface RangeIssue {
  readonly edge: "start" | "end";
  readonly message: string;
}

export const blockRangeIssue = (
  range: (typeof TimeBlockDraft.Type)["ranges"][number]
): Option.Option<RangeIssue> => {
  const start = blockMinute(range.start, false);
  const end = blockMinute(range.end, true);

  if (Option.isNone(start)) {
    return Option.some({
      edge: "start",
      message: "Enter a start time in HH:MM.",
    });
  }

  if (Option.isNone(end)) {
    return Option.some({
      edge: "end",
      message: "Enter an end time in HH:MM, up to 24:00.",
    });
  }

  return start.value >= end.value
    ? Option.some({ edge: "end", message: "End must be after start." })
    : Option.none();
};

export const blockDraftError = (draft: typeof TimeBlockDraft.Type): string => {
  if (draft.name.trim() === "" || draft.ranges.length === 0) {
    return "Enter a name and at least one range.";
  }

  return draft.ranges.some((range) => Option.isSome(blockRangeIssue(range)))
    ? "Check the highlighted range."
    : "Choose a colour.";
};

export const TimeBlockEditorContext = Schema.Struct({
  draft: TimeBlockDraft,
  error: Schema.Option(Schema.String),
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const TimeBlockEditor = Schema.Struct({
  context: TimeBlockEditorContext,
  value: Schema.Literals(["closed", "editing"]),
});

export const TimeBlockAction = Schema.TaggedUnion({
  Add: {},
  AddRange: {},
  Cancel: {},
  Color: { value: Schema.String },
  Edit: { id: Schema.Int },
  Enable: { value: Schema.Boolean },
  Hidden: { value: Schema.Boolean },
  Name: { value: Schema.String },
  Range: {
    edge: Schema.Literals(["start", "end"]),
    index: Schema.Int,
    value: Schema.String,
  },
  Remove: { id: Schema.Int },
  RemoveRange: { index: Schema.Int },
  Save: {},
});

export const blankBlockDraft = (id = 0): typeof TimeBlockDraft.Type => ({
  color: "#7d8d85",
  hidden: false,
  id,
  name: "",
  original: Option.none(),
  ranges: [{ end: "", start: "" }],
});

export const initialTimeBlockEditor = (): typeof TimeBlockEditor.Type => ({
  context: { draft: blankBlockDraft(), error: Option.none(), sequence: 0 },
  value: "closed",
});

export const blockDraft = (
  block: typeof TimeBlock.Type
): typeof TimeBlockDraft.Type => ({
  ...block,
  original: Option.some(block),
  ranges: block.ranges.map((range) => ({
    end: blockClock(range.endMinute),
    start: blockClock(range.startMinute),
  })),
});

export const validatedBlock = (
  draft: typeof TimeBlockDraft.Type
): Option.Option<typeof TimeBlock.Type> =>
  Option.all(
    draft.ranges.map((range) =>
      Option.all({
        endMinute: blockMinute(range.end, true),
        startMinute: blockMinute(range.start, false),
      })
    )
  ).pipe(
    Option.flatMap((ranges) =>
      Schema.decodeOption(TimeBlock)({
        ...draft,
        name: draft.name.trim(),
        ranges,
      })
    )
  );
