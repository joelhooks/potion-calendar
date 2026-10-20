import { Buffer } from "node:buffer";

import { NodeServices } from "@effect/platform-node";
import { foldkit } from "@foldkit/vite-plugin";
import { Config, Effect, Option, Predicate, Schema } from "effect";
import { defineConfig } from "vite";

import { releaseFingerprint } from "./release.js";

type DevelopmentFactory = (
  origin: string
) => (request: Request) => Promise<Response>;

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
    {
      configureServer(server) {
        const portlessOrigin = Effect.runSync(
          Config.String("PORTLESS_URL").pipe(Config.option)
        );

        const backends = new Map<
          string,
          (request: Request) => Promise<Response>
        >();

        server.middlewares.use((incoming, outgoing, next) => {
          const origin = Option.getOrElse(
            portlessOrigin,
            () => `http://${incoming.headers.host ?? "calendar.localhost"}`
          );

          const url = new URL(incoming.url ?? "/", origin);

          if (
            !url.pathname.startsWith("/auth/") &&
            !url.pathname.startsWith("/rpc") &&
            !url.pathname.startsWith("/__fake-google/") &&
            url.pathname !== "/refused"
          ) {
            next();

            return;
          }

          // @effect-diagnostics-next-line asyncFunction:off -- Vite's Connect middleware and module loader expose Promises.
          const respond = async () => {
            let backend = backends.get(origin);

            if (!backend) {
              const module = Schema.decodeUnknownSync(
                Schema.Struct({
                  makeDevelopmentBackend: Schema.declare<DevelopmentFactory>(
                    (input): input is DevelopmentFactory =>
                      Predicate.isFunction(input)
                  ),
                })
              )(await server.ssrLoadModule("#backend"));

              backend = module.makeDevelopmentBackend(origin);
              backends.set(origin, backend);
            }

            const chunks: Uint8Array[] = [];

            for await (const chunk of incoming) {
              chunks.push(Schema.decodeUnknownSync(Schema.Uint8Array)(chunk));
            }

            const headers = new Headers();

            for (const [name, value] of Object.entries(incoming.headers)) {
              if (value !== undefined) {
                headers.set(
                  name,
                  Array.isArray(value) ? value.join(", ") : value
                );
              }
            }

            const response = await backend(
              new Request(url, {
                body:
                  incoming.method === "GET" || incoming.method === "HEAD"
                    ? null
                    : Buffer.concat(chunks),
                headers,
                method: incoming.method ?? "GET",
              })
            );

            for (const [name, value] of response.headers) {
              if (name !== "set-cookie") {
                outgoing.setHeader(name, value);
              }
            }

            outgoing.setHeader("set-cookie", response.headers.getSetCookie());
            outgoing.writeHead(response.status);
            outgoing.end(new Uint8Array(await response.arrayBuffer()));
          };

          // oxlint-disable-next-line promise/no-callback-in-promise, promise/prefer-await-to-then -- Connect middleware receives asynchronous failures through next.
          void respond().catch(next);
        });
      },
      name: "calendar-development-backend",
    },
  ],
});
