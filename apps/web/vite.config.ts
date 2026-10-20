import { NodeServices } from "@effect/platform-node";
import { foldkit } from "@foldkit/vite-plugin";
import { Effect } from "effect";
import { defineConfig } from "vite";

import { releaseFingerprint } from "./release.js";
import { nativeDevelopmentBackend } from "./src/dev/vite-backend.js";

export default defineConfig({
  build: {
    outDir: "dist/client",
    rolldownOptions: { external: [/^cloudflare:/u] },
  },
  plugins: [
    foldkit(),
    {
      // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits the build hook; fingerprint I/O stays in Effect.
      async generateBundle() {
        const generation = await Effect.runPromise(
          releaseFingerprint.pipe(Effect.provide(NodeServices.layer))
        );

        this.emitFile({
          fileName: "release.json",
          source: JSON.stringify({ generation }),
          type: "asset",
        });
      },
      name: "calendar-release",
    },
    nativeDevelopmentBackend(),
  ],
});
