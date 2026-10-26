import { Effect, Queue, Stream } from "effect";

import { IcsFileSaver } from "../src/ics-save.js";
import type { IcsSavePort } from "../src/ics-save.js";
import { icsBridgeFixture } from "./ics-bridge-fixture.js";

interface NativeIcsEnvelope {
  readonly message: string;
  readonly reject: (error: Error) => void;
  readonly resolve: (message: string) => void;
}

export const nativeIcsBridgeFixture = Effect.fn("test.nativeIcsBridgeFixture")(
  function* nativeIcsBridgeFixture(port: IcsSavePort) {
    const pending = yield* Queue.unbounded<NativeIcsEnvelope>();

    const saver = yield* IcsFileSaver.pipe(
      Effect.provide(IcsFileSaver.layer(port))
    );

    const calls: string[] = [];

    // oxlint-disable promise/avoid-new -- This one native Promise boundary queues work into the existing test Effect scope without introducing an Effect runner.
    const fixture = icsBridgeFixture(
      // oxlint-disable-next-line typescript/promise-function-async -- The owned fake implements the native IPC Promise boundary without another runtime.
      (message) =>
        // @effect-diagnostics-next-line newPromise:off -- The real preload bridge needs a native Promise; the existing test Effect scope owns the actual main handler.
        new Promise<string>((resolve, reject) => {
          calls.push(message);

          if (!Queue.offerUnsafe(pending, { message, reject, resolve })) {
            reject(new Error("ICS test transport is closed"));
          }
        })
    );
    // oxlint-enable promise/avoid-new -- The native Promise boundary ends here.

    const scope = yield* Effect.scope;
    yield* Stream.fromQueue(pending).pipe(
      Stream.runForEach(({ message, reject, resolve }) =>
        saver.handle(message, Effect.succeed(true)).pipe(
          Effect.tap((reply) =>
            Effect.sync(() => {
              resolve(reply);
            })
          ),
          Effect.orElseSucceed(() => {
            reject(new Error("ICS test transport failed"));
          })
        )
      ),
      Effect.forkIn(scope)
    );
    yield* Effect.addFinalizer(() => Queue.shutdown(pending));

    return { ...fixture, calls };
  }
);
