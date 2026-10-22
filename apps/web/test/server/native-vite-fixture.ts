// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite middleware requires an owned native Node HTTP listener; Effect owns its scoped lifetime.
import { createServer as createHttpServer } from "node:http";

import { Cause, Effect, Schema } from "effect";
import { createServer } from "vite";

import { nativeDevelopmentBackend } from "../../src/dev/vite-backend.js";
import type { NativeDevelopmentBackendOptions } from "../../src/dev/vite-backend.js";

type Listener = ReturnType<typeof createHttpServer>;

const Address = Schema.Struct({
  address: Schema.String,
  family: Schema.String,
  port: Schema.Int,
});

const closeListener = (listener: Listener) =>
  Effect.callback<Listener, Cause.UnknownError>((resume) => {
    if (!listener.listening) {
      resume(Effect.succeed(listener));

      return;
    }

    listener.close((cause) => {
      resume(
        cause === undefined
          ? Effect.succeed(listener)
          : Effect.fail(
              new Cause.UnknownError(cause, "Fixture listener close failed")
            )
      );
    });
  });

type BindListener = (listener: Listener, ready: () => void) => void;

const bindListener: BindListener = (listener, ready) => {
  listener.listen(0, "127.0.0.1", ready);
};

export const heldNativeListener = Effect.fnUntraced(
  function* heldNativeListener(bind: BindListener = bindListener) {
    const listener = yield* Effect.acquireRelease(
      Effect.gen(function* acquireBoundListener() {
        const owned = yield* Effect.sync(() => createHttpServer());

        return yield* Effect.callback<Listener, Cause.UnknownError>(
          (resume) => {
            const failed = (cause: Error) => {
              resume(
                Effect.fail(
                  new Cause.UnknownError(cause, "Fixture listener bind failed")
                )
              );
            };

            owned.once("error", failed);
            bind(owned, () => {
              resume(Effect.succeed(owned));
            });

            return Effect.sync(() => {
              owned.removeListener("error", failed);
            });
          }
        );
      }),
      (server) => closeListener(server).pipe(Effect.orDie)
    );

    const address = yield* Schema.decodeUnknownEffect(Address)(
      listener.address()
    );

    return { address, listener };
  }
);

export const nativeViteFixture = Effect.fnUntraced(function* nativeViteFixture(
  options?: NativeDevelopmentBackendOptions
) {
  const { address, listener } = yield* heldNativeListener();

  const server = yield* Effect.acquireRelease(
    Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(cause, "Vite fixture startup failed"),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        createServer({
          configFile: false,
          logLevel: "silent",
          plugins: [nativeDevelopmentBackend(options)],
          root: new URL("../../", import.meta.url).pathname,
          server: {
            hmr: false,
            host: "127.0.0.1",
            middlewareMode: true,
            port: address.port,
          },
        }),
    }),
    (instance) =>
      Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Vite fixture shutdown failed"),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => instance.close(),
      }).pipe(Effect.orDie)
  );

  listener.on("request", server.middlewares);

  return { address, listener, server };
});
