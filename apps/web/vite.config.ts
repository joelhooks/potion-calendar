import { NodeServices } from "@effect/platform-node";
import { foldkit } from "@foldkit/vite-plugin";
import { Cause, Effect, Exit } from "effect";
import { defineConfig } from "vite";

import { releaseFingerprint } from "./release.js";
import { reminderWorkerBundle } from "./reminder-worker-build.js";
import { nativeDevelopmentBackend } from "./src/dev/vite-backend.js";

export default defineConfig({
  build: {
    outDir: "dist/client",
    rolldownOptions: { external: [/^cloudflare:/u] },
  },
  plugins: [
    foldkit(),
    {
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const path = request.url?.split("?")[0];

          if (path !== "/reminder-worker.js") {
            next();

            return;
          }

          if (request.method !== "GET" && request.method !== "HEAD") {
            response.statusCode = 404;
            response.end();

            return;
          }

          const cancel = Effect.runCallback(reminderWorkerBundle, {
            onExit: (exit) => {
              if (Exit.isFailure(exit)) {
                next(Cause.squash(exit.cause));

                return;
              }

              response.setHeader(
                "content-type",
                "application/javascript; charset=utf-8"
              );
              response.setHeader("cache-control", "no-store");
              response.setHeader("x-content-type-options", "nosniff");
              response.end(request.method === "HEAD" ? "" : exit.value);
            },
          });

          response.once("close", cancel);
        });
      },
      // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits the build hook; fingerprint I/O stays in Effect.
      async generateBundle() {
        const worker = await Effect.runPromise(reminderWorkerBundle);
        this.emitFile({
          fileName: "reminder-worker.js",
          source: worker,
          type: "asset",
        });

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
