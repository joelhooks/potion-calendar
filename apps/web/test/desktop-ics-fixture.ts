import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type {
  DesktopBridge,
  IcsSaveOutcome,
  IcsSaveRequest,
} from "@calendar/core/desktop-bridge";
import { Effect, Exit, Function, Layer, Queue, Stream } from "effect";

import { EditingRuntime } from "../src/client/editing/runtime.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";

const forbiddenDomainWork = Effect.die(
  new Error("ICS export must not invoke editing or search")
);

export const unusedIcsRootLayers = Layer.mergeAll(
  unusedBrowserLayers,
  Layer.succeed(
    EditingRuntime,
    EditingRuntime.of({
      connect: () => forbiddenDomainWork,
      dispatch: () => forbiddenDomainWork,
    })
  ),
  Layer.succeed(
    CalendarSearchClient,
    CalendarSearchClient.of({
      prefetch: () => forbiddenDomainWork,
      search: () => forbiddenDomainWork,
    })
  )
);

const unexpected = (): never => {
  throw new Error("Unexpected desktop method in the browser ICS fixture");
};

export const browserIcsBridge = (
  saveIcs?: DesktopBridge["saveIcs"]
): DesktopBridge => {
  const bridge: DesktopBridge = {
    // oxlint-disable-next-line typescript/promise-function-async -- The faithful browser-side stand-in returns the native settings Promise without another runtime.
    getSettings: () =>
      Promise.resolve({
        issues: [],
        openAtLogin: false,
        preferences: defaultDesktopPreferences(),
        revision: 1,
      }),
    joinMeeting: unexpected,
    onAction: () => Function.constVoid,
    onSettings: () => Function.constVoid,
    publishAgenda: unexpected,
    savePreferences: unexpected,
    setStartup: unexpected,
  };

  return saveIcs === undefined ? bridge : { ...bridge, saveIcs };
};

interface IcsReceiptEnvelope {
  readonly reject: (error: Error) => void;
  readonly request: typeof IcsSaveRequest.Type;
  readonly resolve: (outcome: typeof IcsSaveOutcome.Type) => void;
}

export interface BrowserIcsReceiptPort {
  readonly save: (
    request: typeof IcsSaveRequest.Type
  ) => Effect.Effect<typeof IcsSaveOutcome.Type>;
}

export const desktopIcsFixture = Effect.fn("test.desktopIcsFixture")(
  function* desktopIcsFixture(port: BrowserIcsReceiptPort) {
    const pending = yield* Queue.unbounded<IcsReceiptEnvelope>();
    const calls: (typeof IcsSaveRequest.Type)[] = [];

    // oxlint-disable promise/avoid-new -- This one native Promise stand-in queues work into the existing test Effect scope without an Effect runner.
    const bridge = browserIcsBridge(
      // oxlint-disable-next-line typescript/promise-function-async -- The browser test implements the typed native Promise boundary, not desktop implementation code.
      (request) =>
        // @effect-diagnostics-next-line newPromise:off -- The browser consumes a native Promise; the existing test scope owns its controlled receipt.
        new Promise<typeof IcsSaveOutcome.Type>((resolve, reject) => {
          calls.push(request);

          if (!Queue.offerUnsafe(pending, { reject, request, resolve })) {
            reject(new Error("ICS test transport is closed"));
          }
        })
    );
    // oxlint-enable promise/avoid-new -- The native Promise stand-in ends here.

    const scope = yield* Effect.scope;
    yield* Stream.fromQueue(pending).pipe(
      Stream.runForEach(({ reject, request, resolve }) =>
        port.save(request).pipe(
          Effect.tap((outcome) =>
            Effect.sync(() => {
              resolve(outcome);
            })
          ),
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isFailure(exit)) {
                reject(new Error("ICS test receipt failed"));
              }
            })
          )
        )
      ),
      Effect.forkIn(scope)
    );
    yield* Effect.addFinalizer(() => Queue.shutdown(pending));

    return { bridge, calls };
  }
);

export const calendarText = (size = 256): string => {
  const header = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-PADDING:";
  const footer = "\r\nEND:VCALENDAR\r\n";

  return `${header}${"x".repeat(size - header.length - footer.length)}${footer}`;
};
