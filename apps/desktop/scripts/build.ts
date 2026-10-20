import { Effect } from "effect";
import { build } from "vite";

import { DesktopError } from "../src/config.ts";

const bundle = Effect.tryPromise({
  catch: (cause) =>
    new DesktopError({ cause, message: "Desktop build failed" }),
  // @effect-diagnostics-next-line asyncFunction:off -- Vite exposes its explicit build operation as a native Promise.
  try: async () => {
    await build();
    await build({
      build: {
        emptyOutDir: false,
        lib: {
          entry: "src/client/preload.ts",
          fileName: () => "preload.cjs",
          formats: ["cjs"],
        },
        rolldownOptions: {
          external: [/^node:/u, "electron"],
          platform: "node",
        },
        ssr: true,
        target: "node24",
      },
      configFile: false,
      ssr: { noExternal: true },
    });
  },
});

await Effect.runPromise(bundle);
