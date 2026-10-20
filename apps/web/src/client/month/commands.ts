import { Effect } from "effect";
import { Command } from "foldkit";

import { Message } from "../message.js";
import { MonthReadOutcome, MonthRuntime } from "./runtime.js";

export const AcknowledgeMonthRead = Command.define("AcknowledgeMonthRead", {
  args: MonthReadOutcome.fields,
  execute: (outcome) =>
    MonthRuntime.use((runtime) => runtime.acknowledge(outcome)).pipe(
      Effect.as(Message.CompletedMonthRead())
    ),
  messages: [Message.CompletedMonthRead],
});
