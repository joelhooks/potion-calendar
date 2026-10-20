import { EventEmitter } from "node:events";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- This seam sends only a local fake callback to the one-shot listener.
import { get } from "node:http";
import { createConnection } from "node:net";

import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, Result, Schema } from "effect";
import { TestClock } from "effect/testing";

import { DesktopError } from "../src/config.js";
import { waitForSignIn } from "../src/loopback.js";

const awaitOpened = (opened: Promise<readonly unknown[]>) =>
  Effect.promise(
    // @effect-diagnostics-next-line asyncFunction:off -- The native event Promise bridges Node's listening callback into the scoped Effect test.
    async () => await opened
  ).pipe(
    Effect.flatMap((values) =>
      Schema.decodeUnknownEffect(Schema.Struct({ detail: Schema.String }))(
        values[0]
      )
    ),
    Effect.map((event) => new URL(event.detail))
  );

const callbackStatus = (url: URL) =>
  Effect.callback<number, DesktopError>((resume) => {
    const request = get(url, (response) => {
      response.resume();
      resume(Effect.succeed(response.statusCode ?? 0));
    });

    request.once("error", () => {
      resume(
        Effect.fail(
          new DesktopError({ message: "Local callback request failed" })
        )
      );
    });

    return Effect.sync(() => {
      request.destroy();
    });
  });

for (const valid of [true, false]) {
  it.effect(
    `the one-shot listener flushes and ${valid ? "accepts" : "refuses"} its callback`,
    () =>
      Effect.gen(function* callbackResult() {
        const observed = new EventTarget();
        const opened = EventEmitter.once(observed, "opened");

        const fiber = yield* waitForSignIn(
          "https://calendar.wzrrd.sh",
          // @effect-diagnostics-next-line asyncFunction:off -- The fake implements the native browser opener without opening a browser.
          async (url) => {
            observed.dispatchEvent(new CustomEvent("opened", { detail: url }));
            await Promise.resolve();
          }
        ).pipe(Effect.result, Effect.forkChild);

        const started = yield* awaitOpened(opened);

        const callback = new URL(
          `http://127.0.0.1:${started.searchParams.get("port")}/callback`
        );

        callback.searchParams.set("token", "b".repeat(64));
        const state = started.searchParams.get("state") ?? "";
        const wrong = `${state.startsWith("a") ? "b" : "a"}${state.slice(1)}`;
        callback.searchParams.set("state", valid ? state : wrong);
        expect(yield* callbackStatus(callback)).toBe(valid ? 200 : 400);
        const result = yield* Fiber.join(fiber);

        if (valid) {
          expect(result).toEqual(Result.succeed(Option.some("b".repeat(64))));
        } else {
          expect(Result.isFailure(result)).toBe(true);
        }
      })
  );
}

it.effect(
  "the callback listener closes when its two minute deadline expires",
  () =>
    Effect.gen(function* listenerDeadline() {
      const observed = new EventTarget();
      const opened = EventEmitter.once(observed, "opened");

      const fiber = yield* waitForSignIn(
        "https://calendar.wzrrd.sh",
        // @effect-diagnostics-next-line asyncFunction:off -- The fake implements Electron's native browser-opening Promise boundary.
        async (url) => {
          observed.dispatchEvent(new CustomEvent("opened", { detail: url }));
          await Promise.resolve();
        }
      ).pipe(Effect.forkChild);

      const url = yield* awaitOpened(opened);
      const port = url.searchParams.get("port");
      expect(Number(port)).toBeGreaterThanOrEqual(1024);
      expect(url.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/u);
      yield* TestClock.adjust("2 minutes");
      expect(Option.isNone(yield* Fiber.join(fiber))).toBe(true);

      const closed = yield* Effect.callback<boolean>((resume) => {
        const socket = createConnection({
          host: "127.0.0.1",
          port: Number(port),
        });

        socket.once("connect", () => {
          resume(Effect.succeed(false));
        });
        socket.once("error", () => {
          resume(Effect.succeed(true));
        });

        return Effect.sync(() => {
          socket.destroy();
        });
      });

      expect(closed).toBe(true);
    })
);
