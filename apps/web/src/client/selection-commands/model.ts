import {
  CalendarEvent,
  CalendarReadFailure,
  ReadNeighborOccurrenceInput,
} from "@calendar/calendar/contracts";
import { Option, Schema } from "effect";

export const OccurrenceTask = Schema.Struct({
  anchor: CalendarEvent,
  context: Schema.String,
  personId: Schema.String,
  request: ReadNeighborOccurrenceInput,
  revision: Schema.Int,
  selection: Schema.String,
});

export const OccurrenceProblem = Schema.TaggedUnion({
  Request: { failure: CalendarReadFailure },
  Transport: { cause: Schema.optional(Schema.Defect()) },
});

export const OccurrenceNotice = Schema.TaggedUnion({
  Failed: { problem: OccurrenceProblem, task: OccurrenceTask },
  Loading: { task: OccurrenceTask },
  Ready: { event: Schema.NullOr(CalendarEvent), task: OccurrenceTask },
});

export const SelectionCommands = Schema.Struct({
  notice: Schema.Option(OccurrenceNotice),
  revision: Schema.Int,
  task: Schema.Option(OccurrenceTask),
});

export const initialSelectionCommands = (): typeof SelectionCommands.Type => ({
  notice: Option.none(),
  revision: 0,
  task: Option.none(),
});
