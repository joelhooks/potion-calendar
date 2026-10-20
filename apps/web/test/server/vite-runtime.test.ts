import { createServer as createPortReservation } from "node:net";

import { SessionSnapshot } from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { Cause, Effect, Option, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { createServer } from "vite";

import { nativeDevelopmentBackend } from "../../src/dev/vite-backend.js";
import { rpcValue } from "./calendar-rpc.js";

const Address = Schema.Struct({ port: Schema.Int });

const availablePort = Effect.callback<number, Cause.UnknownError>((resume) => {
  const reservation = createPortReservation();
  reservation.once("error", (cause) => {
    resume(
      Effect.fail(new Cause.UnknownError(cause, "Loopback reservation failed"))
    );
  });
  reservation.listen(0, "127.0.0.1", () => {
    const address = Schema.decodeUnknownOption(Address)(reservation.address());
    reservation.close((cause) => {
      if (cause !== undefined || Option.isNone(address)) {
        resume(
          Effect.fail(
            new Cause.UnknownError(cause, "Loopback reservation did not close")
          )
        );

        return;
      }

      resume(Effect.succeed(address.value.port));
    });
  });

  return Effect.sync(() => {
    if (reservation.listening) {
      reservation.close();
    }
  });
});

const rpc = (port: number) =>
  Effect.gen(function* firstSession() {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.execute(
      HttpClientRequest.post(`http://127.0.0.1:${port}/rpc`).pipe(
        HttpClientRequest.setHeader("origin", `http://127.0.0.1:${port}`),
        HttpClientRequest.bodyText(
          '{"_tag":"Request","headers":[],"id":"1","payload":{},"tag":"session"}',
          "application/json"
        )
      )
    );

    expect(response.status).toBe(200);

    const session = yield* HttpClientResponse.schemaBodyJson(
      rpcValue(SessionSnapshot)
    )(response);

    expect(session[0].exit.value?.accounts).toHaveLength(2);
  });

const desktopRoute = (port: number) =>
  Effect.gen(function* desktopThroughVite() {
    const client = yield* HttpClient.HttpClient;

    const response = yield* client.get(
      `http://127.0.0.1:${port}/desktop/sign-in`
    );

    expect(response.status).toBe(400);
    expect(yield* response.text).toContain("<h1>Sign-in failed</h1>");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

const nativeReachable = (origin: string) =>
  Effect.gen(function* nativeListener() {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(origin);
    yield* response.text;
  }).pipe(Effect.result);

const Proxy = Schema.Struct({
  "/live": Schema.Struct({ target: Schema.String }),
});

it.live(
  "two native Vite lifetimes (measured 2.3–4.3s) retain sessions and close retired listeners",
  () =>
    Effect.gen(function* viteRuntimeLifetime() {
      const port = yield* availablePort;

      const server = yield* Effect.acquireRelease(
        Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Vite fixture startup failed"),
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () =>
            createServer({
              configFile: false,
              logLevel: "silent",
              plugins: [nativeDevelopmentBackend()],
              root: new URL("../../", import.meta.url).pathname,
              server: { host: "127.0.0.1", port },
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

      yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Vite fixture listen failed"),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => server.listen(),
      });

      const first = yield* Schema.decodeUnknownEffect(Proxy)(
        server.config.server.proxy
      );

      expect((yield* nativeReachable(first["/live"].target))._tag).toBe(
        "Success"
      );
      yield* rpc(port);
      yield* desktopRoute(port);
      yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Vite fixture restart failed"),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => server.restart(),
      });

      const second = yield* Schema.decodeUnknownEffect(Proxy)(
        server.config.server.proxy
      );

      expect(second["/live"].target).not.toBe(first["/live"].target);
      expect((yield* nativeReachable(first["/live"].target))._tag).toBe(
        "Failure"
      );
      yield* rpc(port);
      yield* desktopRoute(port);
      yield* Effect.tryPromise({
        catch: (cause) =>
          new Cause.UnknownError(cause, "Vite fixture close failed"),
        // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
        try: () => server.close(),
      });
      expect((yield* nativeReachable(second["/live"].target))._tag).toBe(
        "Failure"
      );
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  15_000
);
