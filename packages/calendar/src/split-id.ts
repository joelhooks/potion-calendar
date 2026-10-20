import { DateTime, Effect } from "effect";

import { Provider } from "./errors.js";
import type { CalendarEventValue } from "./model.js";
import { timeValue } from "./recurrence.js";

const base32hex = (bytes: Uint8Array) => {
  const alphabet = "0123456789abcdefghijklmnopqrstuv";

  const bits = Array.from(bytes, (byte) =>
    byte.toString(2).padStart(8, "0")
  ).join("");

  let result = "";

  for (let offset = 0; offset < bits.length; offset += 5) {
    const group = bits.slice(offset, offset + 5).padEnd(5, "0");
    result += alphabet.charAt(Number.parseInt(group, 2));
  }

  return result;
};

export const splitSuccessorId = Effect.fn("splitSuccessorId")(
  function* splitSuccessorId(
    master: CalendarEventValue,
    selected: CalendarEventValue
  ) {
    const original = selected.originalStartTime ?? selected.start;

    if (original === undefined) {
      return yield* new Provider({
        message: "Recurring instance has no split instant",
        operation: "split.id",
        status: 0,
      });
    }

    const instant = yield* timeValue(original);

    const anchor =
      "date" in original ? original.date : DateTime.formatIso(instant);

    const key = JSON.stringify([
      master.accountId,
      master.calendarId,
      master.eventId,
      anchor,
    ]);

    const digest = yield* Effect.tryPromise({
      catch: () =>
        new Provider({
          message: "Could not derive the recurring successor id",
          operation: "split.id",
          status: 0,
        }),
      // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this native Promise boundary.
      try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
    });

    return base32hex(new Uint8Array(digest));
  }
);
