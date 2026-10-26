import {
  IcsSaveOutcome,
  IcsSaveRequest,
  desktopIcsFilename,
  icsSaveByteLimit,
  icsSaveParseOptions,
} from "@calendar/core/desktop-bridge";
import type { DesktopBridge } from "@calendar/core/desktop-bridge";
import { Effect, Match, Option, Schema } from "effect";

export const saveDesktopIcs = Effect.fn("Desktop.saveIcs")(
  function* saveDesktopIcs(
    bridge: DesktopBridge,
    content: string,
    filename: string
  ) {
    const save = bridge.saveIcs;

    if (save === undefined) {
      return IcsSaveOutcome.cases.Failed.make({ reason: "unavailable" });
    }

    if (content.length > icsSaveByteLimit) {
      return IcsSaveOutcome.cases.Failed.make({ reason: "tooLarge" });
    }

    const bytes = new TextEncoder().encode(content);

    if (bytes.byteLength > icsSaveByteLimit) {
      return IcsSaveOutcome.cases.Failed.make({ reason: "tooLarge" });
    }

    const request = yield* Schema.decodeEffect(
      IcsSaveRequest,
      icsSaveParseOptions
    )({ bytes, suggestedName: desktopIcsFilename(filename) }).pipe(
      Effect.option
    );

    if (Option.isNone(request)) {
      return IcsSaveOutcome.cases.Failed.make({ reason: "invalid" });
    }

    return yield* Effect.tryPromise({
      catch: () => IcsSaveOutcome.cases.Failed.make({ reason: "transport" }),
      // @effect-diagnostics-next-line asyncFunction:off -- The browser invokes only the isolated save capability and decodes its completion before showing Saved.
      try: async () => await save(request.value),
    }).pipe(
      Effect.flatMap(Schema.decodeEffect(IcsSaveOutcome, icsSaveParseOptions)),
      Effect.orElseSucceed(() =>
        IcsSaveOutcome.cases.Failed.make({ reason: "transport" })
      )
    );
  }
);

export const desktopIcsMessage = (
  outcome: typeof IcsSaveOutcome.Type,
  skipped: number
): string =>
  Match.value(outcome).pipe(
    Match.tagsExhaustive({
      Cancelled: () => "Export cancelled.",
      Failed: ({ reason }) =>
        reason === "tooLarge"
          ? "This export is too large to save."
          : "Couldn't save the calendar file. Try exporting again.",
      Saved: () =>
        skipped === 0
          ? "Saved."
          : `Saved. Skipped ${skipped} repeating series in a time zone. Select one occurrence to export it.`,
    })
  );
