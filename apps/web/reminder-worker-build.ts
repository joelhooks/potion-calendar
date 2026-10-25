import { Effect, Schema } from "effect";
import { build } from "vite";

export class ReminderWorkerBuildFailure extends Schema.TaggedError<ReminderWorkerBuildFailure>()(
  "ReminderWorkerBuildFailure",
  {}
) {}

export const reminderWorkerBundle = Effect.gen(
  function* reminderWorkerBundle() {
    const result = yield* Effect.tryPromise({
      catch: () => new ReminderWorkerBuildFailure(),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; Vite exposes a native Promise build API.
      try: () =>
        build({
          build: {
            emptyOutDir: false,
            lib: {
              entry: new URL("src/reminder-worker.ts", import.meta.url)
                .pathname,
              formats: ["iife"],
              name: "CalendarReminderWorker",
            },
            minify: true,
            write: false,
          },
          configFile: false,
          logLevel: "silent",
          publicDir: false,
        }),
    });

    const outputs = Array.isArray(result) ? result : [result];

    const chunks = outputs.flatMap((output) =>
      "output" in output ? output.output : []
    );

    const entry = chunks.find(
      (chunk) => chunk.type === "chunk" && chunk.isEntry
    );

    if (entry?.type !== "chunk") {
      return yield* new ReminderWorkerBuildFailure();
    }

    return entry.code;
  }
);
