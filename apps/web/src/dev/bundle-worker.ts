import { NodeCrypto } from "@effect/platform-node";
import { Cause, Crypto, Effect, Schema } from "effect";
import { build } from "vite";

interface WorkerModule {
  readonly contents: string;
  readonly path: string;
  readonly type: "ESModule";
}

export interface WorkerArtifact {
  readonly hash: string;
  readonly modules: readonly WorkerModule[];
}

export class WorkerArtifactMismatch extends Schema.TaggedError<WorkerArtifactMismatch>()(
  "WorkerArtifactMismatch",
  { actual: Schema.String, expected: Schema.String }
) {}

export const workerModuleHash = Effect.fn("workerModuleHash")(
  function* workerModuleHash(modules: readonly WorkerModule[]) {
    const crypto = yield* Crypto.Crypto;

    const bytes = new TextEncoder().encode(
      JSON.stringify(
        modules.map(({ path, type, contents }) => [path, type, contents])
      )
    );

    const digest = yield* crypto.digest("SHA-256", bytes);

    return yield* Schema.encodeEffect(Schema.Uint8ArrayFromHex)(digest);
  },
  Effect.provide(NodeCrypto.layer)
);

export const bundleCalendarWorker = Effect.fn("bundleCalendarWorker")(
  function* bundleCalendarWorker(entry: string) {
    const modules: WorkerModule[] = [];

    yield* Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(cause, "Native Promise adapter failed"),

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        build({
          build: {
            minify: false,
            rolldownOptions: { input: entry },
            ssr: true,
            write: false,
          },
          configFile: false,
          logLevel: "silent",
          plugins: [
            {
              generateBundle(_options, bundle) {
                for (const output of Object.values(bundle)) {
                  if (output.type !== "chunk") {
                    continue;
                  }

                  const module: WorkerModule = {
                    contents: output.code,
                    path: `/calendar/${output.fileName}`,
                    type: "ESModule",
                  };

                  if (output.isEntry) {
                    modules.unshift(module);
                  } else {
                    modules.push(module);
                  }
                }
              },
              name: "calendar-native-worker",
            },
          ],
          ssr: { noExternal: true },
        }),
    });

    return modules;
  }
);

export const bundleCalendarWorkerArtifact = Effect.fn(
  "bundleCalendarWorkerArtifact"
)(function* bundleCalendarWorkerArtifact(entry: string) {
  const modules = Object.freeze(
    (yield* bundleCalendarWorker(entry)).map((module) => Object.freeze(module))
  );

  const hash = yield* workerModuleHash(modules);

  return Object.freeze({ hash, modules });
});
