import {
  CalendarEvent,
  exportIcsCalendar,
  IcsExportOutcome,
} from "@calendar/calendar/contracts";
import { DateTime, Effect, Option, Schema } from "effect";
import { Command } from "foldkit";

import { browserDesktop } from "../desktop/commands.js";
import { Message } from "../message.js";
import { desktopIcsMessage, saveDesktopIcs } from "./desktop.js";

export const zonedSeriesExportMessage =
  "Repeating series in a time zone can't be exported yet. Select one occurrence to export it.";

export const icsExportRefusal = (reason: string): string => {
  switch (reason) {
    case "zonedRecurringMaster": {
      return zonedSeriesExportMessage;
    }

    case "emptySelection": {
      return "Select at least one event to export it.";
    }

    case "unsupportedRecurrence": {
      return "This repeating series can't be exported yet. Select one occurrence to export it.";
    }

    case "invalidTime": {
      return "The selected events contain a time that can't be exported.";
    }

    default: {
      return "The selected events contain a value that can't be exported.";
    }
  }
};

export const downloadIcsFile = (content: string, filename: string): void => {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const anchor = document.createElement("a");
  const href = URL.createObjectURL(blob);

  try {
    anchor.href = href;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(href);
  }
};

export const DownloadSelectedIcs = Command.define("DownloadSelectedIcs", {
  args: {
    events: Schema.NonEmptyArray(CalendarEvent),
    personId: Schema.String,
    revision: Schema.Int,
  },
  execute: ({ events, personId, revision }) =>
    Effect.gen(function* downloadSelectedIcs() {
      const desktop = browserDesktop();

      if (Option.isSome(desktop) && desktop.value.saveIcs === undefined) {
        return Message.ReceivedIcsExport({
          notice: {
            message:
              "ICS export is available in your browser, not the desktop app.",
            personId,
            revision,
          },
        });
      }

      const stamp = yield* DateTime.now;
      const outcome = exportIcsCalendar(events, stamp);

      if (IcsExportOutcome.guards.Refused(outcome)) {
        return Message.ReceivedIcsExport({
          notice: {
            message: icsExportRefusal(outcome.reason),
            personId,
            revision,
          },
        });
      }

      if (Option.isSome(desktop)) {
        const saved = yield* saveDesktopIcs(
          desktop.value,
          outcome.content,
          outcome.filename
        );

        return Message.ReceivedIcsExport({
          notice: {
            message: desktopIcsMessage(saved, outcome.skipped.length),
            personId,
            revision,
          },
        });
      }

      const message = yield* Effect.try({
        catch: () => "The download couldn't be started. Try exporting again.",
        try: () => {
          downloadIcsFile(outcome.content, outcome.filename);

          return outcome.skipped.length === 0
            ? "Download started."
            : `Download started. Skipped ${outcome.skipped.length} repeating series in a time zone. Select one occurrence to export it.`;
        },
      }).pipe(Effect.catch((error) => Effect.succeed(error)));

      return Message.ReceivedIcsExport({
        notice: { message, personId, revision },
      });
    }),
  messages: [Message.ReceivedIcsExport],
});
