// oxlint-disable typescript/promise-function-async -- The faithful native API fake returns resolved or rejected Promises without asynchronous business logic or a second Effect runtime.
import { IcsSaveOutcome } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { SaveDialogOptions, SaveDialogReturnValue } from "electron";

import { nativeIcsSavePort } from "../src/native-ics-save.js";
import type { NativeIcsSaveApi } from "../src/native-ics-save.js";
import {
  calendarText,
  decodeIcsOutcome,
  encodeIcsRequest,
  icsSaveHandlerFixture,
} from "./ics-save-fixture.js";

interface NativeApiState {
  choice: SaveDialogReturnValue;
  failure: "none" | "dialog" | "write";
}

const nativeApiFixture = () => {
  const state: NativeApiState = {
    choice: { canceled: false, filePath: "/chosen/custom.ics" },
    failure: "none",
  };

  const dialogs: SaveDialogOptions[] = [];

  const writes: {
    readonly bytes: Uint8Array;
    readonly options: Parameters<NativeIcsSaveApi["write"]>[2];
    readonly path: string;
  }[] = [];

  const files = new Map([["/chosen/custom.ics", "existing file"]]);

  const api: NativeIcsSaveApi = {
    choose: (options) => {
      dialogs.push(options);

      return state.failure === "dialog"
        ? Promise.reject(new Error("/private/dialog-path"))
        : Promise.resolve(state.choice);
    },
    write: (path, bytes, options) => {
      writes.push({ bytes: new Uint8Array(bytes), options, path });

      if (state.failure === "write") {
        return Promise.reject(new Error("/private/write-path"));
      }

      files.set(path, new TextDecoder().decode(bytes));

      return Promise.resolve();
    },
  };

  return { api, dialogs, files, state, writes };
};

it.effect(
  "the native adapter filters and confirms the dialog, then writes only its chosen path with the exact bytes",
  () =>
    Effect.gen(function* nativeSaveAdapter() {
      const fixture = nativeApiFixture();

      const handle = yield* icsSaveHandlerFixture(
        nativeIcsSavePort(fixture.api)
      );

      const message = yield* encodeIcsRequest();

      const outcome = yield* handle(message, Effect.succeed(true)).pipe(
        Effect.flatMap(decodeIcsOutcome)
      );

      expect(outcome._tag).toBe("Saved");
      expect(fixture.dialogs).toEqual([
        {
          buttonLabel: "Save",
          defaultPath: "events.ics",
          filters: [{ extensions: ["ics"], name: "Calendar file" }],
          properties: ["showOverwriteConfirmation"],
          title: "Export as .ics",
        },
      ]);
      expect(fixture.writes).toHaveLength(1);
      const [written] = fixture.writes;
      expect(written?.path).toBe("/chosen/custom.ics");
      expect(written?.bytes).toEqual(new TextEncoder().encode(calendarText()));
      expect(written?.options.mode).toBe(0o600);
      expect(written?.options.signal).toBeInstanceOf(AbortSignal);
      expect(fixture.files.get("/chosen/custom.ics")).toBe(calendarText());
      expect(fixture.files.has("events.ics")).toBe(false);
    })
);

it.effect(
  "the native adapter never writes on cancellation, even with a retained path, or a non-ICS chosen path",
  () =>
    Effect.gen(function* nativeRefusals() {
      const fixture = nativeApiFixture();

      const handle = yield* icsSaveHandlerFixture(
        nativeIcsSavePort(fixture.api)
      );

      const message = yield* encodeIcsRequest();

      for (const row of [
        {
          canceled: true,
          expected: "Cancelled",
          filePath: "/chosen/custom.ics",
        },
        { canceled: true, expected: "Cancelled", filePath: "" },
        { canceled: false, expected: "Failed", filePath: "/chosen/custom.txt" },
      ]) {
        fixture.state.choice = row;

        const outcome = yield* handle(message, Effect.succeed(true)).pipe(
          Effect.flatMap(decodeIcsOutcome)
        );

        expect(outcome._tag).toBe(row.expected);
        expect(fixture.writes).toEqual([]);
        expect(fixture.files.get("/chosen/custom.ics")).toBe("existing file");
      }
    })
);

it.effect(
  "native dialog and filesystem rejection cannot report Saved or leak their path",
  () =>
    Effect.gen(function* nativeFailures() {
      const fixture = nativeApiFixture();

      const handle = yield* icsSaveHandlerFixture(
        nativeIcsSavePort(fixture.api)
      );

      const message = yield* encodeIcsRequest();
      fixture.state.failure = "dialog";

      const dialogFailure = yield* handle(message, Effect.succeed(true)).pipe(
        Effect.flatMap(decodeIcsOutcome)
      );

      expect(dialogFailure).toEqual(
        IcsSaveOutcome.cases.Failed.make({ reason: "dialog" })
      );
      expect(fixture.writes).toEqual([]);
      fixture.state.failure = "write";

      const writeFailure = yield* handle(message, Effect.succeed(true)).pipe(
        Effect.flatMap(decodeIcsOutcome)
      );

      expect(writeFailure).toEqual(
        IcsSaveOutcome.cases.Failed.make({ reason: "write" })
      );
      expect(fixture.files.get("/chosen/custom.ics")).toBe("existing file");
      expect(JSON.stringify([dialogFailure, writeFailure])).not.toContain(
        "/private/"
      );
    })
);
