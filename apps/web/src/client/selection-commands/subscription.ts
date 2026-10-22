import { Effect, Option, Schema, Stream } from "effect";
import { Subscription } from "foldkit";

import type { AppModel } from "../app.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import { OccurrenceTask } from "./model.js";
import { OccurrenceRuntime } from "./runtime.js";
import { occurrenceTask } from "./source.js";

export const occurrenceSubscriptions = Subscription.make<
  AppModel,
  AppMessage,
  OccurrenceRuntime
>()((entry) => ({
  occurrenceNavigation: entry(
    { task: Schema.Option(OccurrenceTask) },
    {
      dependenciesToStream: ({ task }) =>
        Option.match(task, {
          onNone: () => Stream.empty,
          onSome: (input) =>
            Stream.unwrap(
              OccurrenceRuntime.use((runtime) =>
                Effect.succeed(runtime.observe(input))
              )
            ).pipe(
              Stream.map((notice) => Message.ReceivedOccurrence({ notice }))
            ),
        }),
      modelToDependencies: (model) => ({ task: occurrenceTask(model) }),
    }
  ),
}));
