import { Effect } from "effect";
import type { SaveDialogOptions, SaveDialogReturnValue } from "electron";

import { IcsSaveChoice, IcsSaveError } from "./ics-save.js";
import type { IcsSavePort } from "./ics-save.js";

export interface NativeIcsSaveApi {
  readonly choose: (
    options: SaveDialogOptions
  ) => Promise<SaveDialogReturnValue>;
  readonly write: (
    path: string,
    bytes: Uint8Array,
    options: { readonly mode: number; readonly signal: AbortSignal }
  ) => Promise<void>;
}

export const nativeIcsSavePort = (api: NativeIcsSaveApi): IcsSavePort => ({
  choose: (suggestedName) =>
    Effect.tryPromise({
      catch: () => new IcsSaveError({ reason: "dialog" }),
      // @effect-diagnostics-next-line asyncFunction:off -- Electron owns the native dialog Promise; the lifecycle observes its completion separately from writing.
      try: async () =>
        await api.choose({
          buttonLabel: "Save",
          defaultPath: suggestedName,
          filters: [{ extensions: ["ics"], name: "Calendar file" }],
          properties: ["showOverwriteConfirmation"],
          title: "Export as .ics",
        }),
    }).pipe(
      Effect.map((result) =>
        result.canceled
          ? IcsSaveChoice.cases.Cancelled.make({})
          : IcsSaveChoice.cases.Chosen.make({ path: result.filePath })
      )
    ),
  write: (path, bytes) =>
    Effect.tryPromise({
      catch: () => new IcsSaveError({ reason: "write" }),
      // @effect-diagnostics-next-line asyncFunction:off -- The OS write Promise settles before Saved; interruption cannot promise that an issued write changed nothing.
      try: async (signal) => {
        await api.write(path, bytes, { mode: 0o600, signal });
      },
    }),
});
