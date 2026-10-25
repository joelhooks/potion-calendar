import { SessionSnapshot } from "@calendar/core/contracts";
import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

import { bundleCalendarWorkerArtifact } from "../../src/dev/bundle-worker.js";
import { rpcValue } from "./calendar-rpc.js";
import {
  heldNativeListener,
  nativeViteFixture,
} from "./native-vite-fixture.js";

const rpc = (port: number, expectedAccounts = 2) =>
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

    expect(session[0].exit.value?.accounts).toHaveLength(expectedAccounts);
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

it.live("a pending native bind stays owned through interruption", () =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* interruptedBind() {
      const pending = yield* Deferred.make<
        Exit.Exit<
          {
            readonly listener: Effect.Success<
              ReturnType<typeof heldNativeListener>
            >["listener"];
            readonly complete: () => void;
          },
          Effect.Error<ReturnType<typeof heldNativeListener>>
        >
      >();

      const fiber = yield* restore(
        heldNativeListener((listener, ready) => {
          listener.listen(0, "127.0.0.1", () => {
            Deferred.doneUnsafe(
              pending,
              Effect.succeed(Exit.succeed({ complete: ready, listener }))
            );
          });
        }).pipe(
          Effect.scoped,
          Effect.onExit((exit) =>
            Deferred.succeed(
              pending,
              Exit.isFailure(exit)
                ? Exit.failCause(exit.cause)
                : Exit.fail(
                    new Cause.UnknownError(
                      undefined,
                      "Native binding ended without its pending handshake"
                    )
                  )
            )
          )
        )
      ).pipe(Effect.forkChild);

      const binding = yield* Deferred.await(pending);

      const { listener, complete } = yield* binding;

      yield* restore(
        Effect.gen(function* inspectPendingInterruption() {
          yield* Effect.sync(() => {
            fiber.interruptUnsafe();
          });
          yield* Effect.yieldNow;
          expect(listener.listening).toBe(true);
          expect(fiber.pollUnsafe()).toBeUndefined();
        })
      ).pipe(Effect.ensuring(Effect.sync(complete)));

      const interrupted = yield* Fiber.await(fiber);

      expect(Exit.isFailure(interrupted)).toBe(true);

      if (Exit.isFailure(interrupted)) {
        expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
      }

      expect(listener.listening).toBe(false);
      expect(listener.address()).toBeNull();
    })
  )
);

it.live(
  "an occupied native bind retains its cause and the existing owner",
  () =>
    Effect.gen(function* occupiedBind() {
      const retired = yield* Effect.gen(function* ownerScope() {
        const owner = yield* heldNativeListener();

        const refused = yield* heldNativeListener((listener, ready) => {
          listener.listen(owner.address.port, "127.0.0.1", ready);
        }).pipe(Effect.exit);

        expect(Exit.isFailure(refused)).toBe(true);

        if (Exit.isFailure(refused)) {
          expect(Cause.pretty(refused.cause)).toContain("EADDRINUSE");
        }

        expect(owner.listener.address()).toEqual(owner.address);
        expect(owner.listener.listening).toBe(true);

        return owner.listener;
      }).pipe(Effect.scoped);

      expect(retired.listening).toBe(false);
      expect(retired.address()).toBeNull();
    })
);

it.live(
  "a native Vite capture can seed one identity without linking the second review person",
  () =>
    Effect.gen(function* isolatedCapturePerson() {
      const { address } = yield* nativeViteFixture({
        initialEmails: ["joel@example.test"],
      });

      yield* rpc(address.port, 1);
    }).pipe(Effect.provide(FetchHttpClient.layer))
);

it.live(
  "two native Vite middleware lifetimes retain sessions and close held and retired listeners",
  () =>
    Effect.gen(function* viteRuntimeLifetime() {
      const worker = yield* bundleCalendarWorkerArtifact(
        new URL("../../src/dev/live-worker.ts", import.meta.url).pathname
      );

      const loadedHashes: string[] = [];

      const retired = yield* Effect.gen(function* fixtureLifetime() {
        const { address, listener, server } = yield* nativeViteFixture({
          onWorkerLoaded: (hash) => {
            loadedHashes.push(hash);
          },
          worker,
        });

        const { port } = address;

        expect(listener.address()).toEqual(address);
        expect(loadedHashes).toEqual([worker.hash]);

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

        expect(listener.address()).toEqual(address);
        expect(loadedHashes).toEqual([worker.hash, worker.hash]);

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
        expect(listener.address()).toEqual(address);

        return listener;
      }).pipe(Effect.scoped);

      expect(retired.address()).toBeNull();
      expect(retired.listening).toBe(false);
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  15_000
);
