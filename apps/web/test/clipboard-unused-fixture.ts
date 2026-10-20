import { Effect, Layer } from "effect";

import { ClipboardRuntime } from "../src/client/clipboard/runtime.js";

const unexpectedClipboardWork = Effect.die(
  "This seam must not invoke clipboard resources"
);

export const unusedClipboardLayer = Layer.succeed(
  ClipboardRuntime,
  ClipboardRuntime.of({
    connect: () => unexpectedClipboardWork,
    dispatch: () => unexpectedClipboardWork,
    validateSession: () => unexpectedClipboardWork,
  })
);
