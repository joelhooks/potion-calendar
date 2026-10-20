import { Buffer } from "node:buffer";

import {
  Config,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Scope,
} from "effect";
import type { Plugin } from "vite";

import { DevelopmentRuntime } from "./native-runtime.js";

export const nativeDevelopmentBackend = (): Plugin => ({
  apply: "serve",
  config() {
    return { server: { host: "127.0.0.1", strictPort: true } };
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits configuration; the scoped Miniflare runtime is disposed when this owned server closes.
  async configureServer(server) {
    const portless = Effect.runSync(
      Config.String("PORTLESS_URL").pipe(Config.option)
    );

    const origin = Option.getOrElse(
      portless,
      () => `http://127.0.0.1:${server.config.server.port ?? 5173}`
    );

    const scope = Scope.makeUnsafe();

    const context = await Effect.runPromise(
      Layer.buildWithScope(DevelopmentRuntime.layer(origin), scope).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) ? Scope.close(scope, Exit.void) : Effect.void
        )
      )
    );

    const runtime = Context.get(context, DevelopmentRuntime);

    const closeRuntime = Effect.runSync(
      Effect.cached(Scope.close(scope, Exit.void))
    );

    const closeServer = server.close.bind(server);

    // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits server.close during restart; the native runtime must finish disposal before that close completes.
    server.close = async () => {
      await Effect.runPromise(closeRuntime);
      await closeServer();
    };

    server.config.server.proxy = {
      ...server.config.server.proxy,
      "/live": { target: runtime.url.origin, ws: true },
    };
    server.httpServer?.once("close", () => {
      void Effect.runPromise(closeRuntime);
    });
    server.middlewares.use((incoming, outgoing, next) => {
      const url = new URL(incoming.url ?? "/", origin);

      if (
        ![
          "/auth/",
          "/rpc",
          "/__fake-google/",
          "/google/push",
          "/refused",
          "/desktop/",
        ].some((prefix) => url.pathname.startsWith(prefix))
      ) {
        next();

        return;
      }

      // @effect-diagnostics-next-line asyncFunction:off -- Connect consumes Node HTTP streams and forwards asynchronous failures through next.
      const respond = async () => {
        const chunks: Uint8Array[] = [];

        for await (const chunk of incoming) {
          chunks.push(Schema.decodeUnknownSync(Schema.Uint8Array)(chunk));
        }

        const headers = new Headers();

        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) {
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
        }

        const response = await runtime.handle(
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
  name: "calendar-native-development-backend",
});
