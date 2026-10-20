import { Cause, Effect } from "effect";
import { build } from "vite";

interface WorkerModule {
  readonly contents: string;
  readonly path: string;
  readonly type: "ESModule";
}

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
