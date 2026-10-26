import {
  desktopWire,
  icsSaveParseOptions,
} from "@calendar/core/desktop-bridge";
import type { IcsSaveOutcome } from "@calendar/core/desktop-bridge";
import { Effect, Schema } from "effect";

import { IcsFileSaver, IcsSaveChoice } from "../src/ics-save.js";
import type { IcsSaveError, IcsSavePort } from "../src/ics-save.js";

export const calendarText = (size = 256): string => {
  const header = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-PADDING:";
  const footer = "\r\nEND:VCALENDAR\r\n";

  return `${header}${"x".repeat(size - header.length - footer.length)}${footer}`;
};

export const icsSaveFixture = (
  choice: Effect.Effect<
    typeof IcsSaveChoice.Type,
    IcsSaveError
  > = Effect.succeed(
    IcsSaveChoice.cases.Chosen.make({ path: "/chosen/export.ics" })
  )
) => {
  const suggestions: string[] = [];
  const writes: { readonly path: string; readonly bytes: Uint8Array }[] = [];

  const port: IcsSavePort = {
    choose: (name) =>
      Effect.sync(() => {
        suggestions.push(name);
      }).pipe(Effect.andThen(choice)),
    write: (path, bytes) =>
      Effect.sync(() => {
        writes.push({ bytes: new Uint8Array(bytes), path });
      }),
  };

  return { port, suggestions, writes };
};

export const icsSaveHandlerFixture = Effect.fn("test.icsSaveHandler")(
  function* icsSaveHandlerFixture(port: IcsSavePort) {
    const saver = yield* IcsFileSaver.pipe(
      Effect.provide(IcsFileSaver.layer(port))
    );

    return saver.handle;
  }
);

export const encodeIcsRequest = (size = 256) =>
  Schema.encodeEffect(
    desktopWire.saveIcs,
    icsSaveParseOptions
  )({
    bytes: new TextEncoder().encode(calendarText(size)),
    suggestedName: "events.ics",
  });

export const decodeIcsOutcome = (
  reply: string
): Effect.Effect<typeof IcsSaveOutcome.Type, Schema.SchemaError> =>
  Schema.decodeEffect(desktopWire.saveIcsReply, icsSaveParseOptions)(reply);
