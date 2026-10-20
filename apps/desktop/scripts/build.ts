// @effect-diagnostics-next-line nodeBuiltinImport:off -- The native build copies only its owned local prompt assets into the application bundle.
import { copyFile } from "node:fs/promises";

import { Effect } from "effect";
import { build } from "vite";

import { DesktopError } from "../src/config.ts";

const bundle = Effect.tryPromise({
  catch: (cause) =>
    new DesktopError({ cause, message: "Desktop build failed" }),
  // @effect-diagnostics-next-line asyncFunction:off -- Vite and the asset copier expose explicit native Promise operations.
  try: async () => {
    await build();

    await Promise.all(
      ["preload", "prompt-preload"].map(
        // @effect-diagnostics-next-line asyncFunction:off -- Two independent native Vite builds write distinct preload files.
        async (entry) =>
          await build({
            build: {
              emptyOutDir: false,
              lib: {
                entry: `src/client/${entry}.ts`,
                fileName: () => `${entry}.cjs`,
                formats: ["cjs"],
              },
              rolldownOptions: {
                external: [/^node:/u, "electron"],
                output: {
                  banner: "const potionPreloadStartedAt = performance.now();",
                },
                platform: "node",
              },
              ssr: true,
              target: "node24",
            },
            configFile: false,
            ssr: { noExternal: true },
          })
      )
    );

    await build({
      build: {
        emptyOutDir: false,
        lib: {
          entry: "src/client/prompt.ts",
          fileName: () => "prompt.js",
          formats: ["iife"],
          name: "PotionPrompt",
        },
        rolldownOptions: { platform: "browser" },
        target: "chrome152",
      },
      configFile: false,
    });
    await copyFile("src/client/prompt.html", "dist/prompt.html");
    await copyFile("src/client/prompt.css", "dist/prompt.css");
  },
});

await Effect.runPromise(bundle);
