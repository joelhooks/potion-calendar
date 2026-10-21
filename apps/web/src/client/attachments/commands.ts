import { CalendarEvent } from "@calendar/calendar/contracts";
import { Effect, Option, Schema } from "effect";
import { Command } from "foldkit";

import { CalendarEditingClient } from "../editing/calendar-client.js";
import { Message } from "../message.js";

export const ReadEventAttachments = Command.define("ReadEventAttachments", {
  args: {
    original: CalendarEvent,
    personId: Schema.String,
    requestId: Schema.Int,
  },
  execute: ({ original, personId, requestId }) =>
    CalendarEditingClient.use((client) => client.getEvent(original)).pipe(
      Effect.match({
        onFailure: () =>
          Message.ReceivedEventAttachments({
            result: { event: Option.none(), original, personId, requestId },
          }),
        onSuccess: (event) =>
          Message.ReceivedEventAttachments({
            result: {
              event: Option.some(event),
              original,
              personId,
              requestId,
            },
          }),
      }),
      Effect.provide(CalendarEditingClient.layer("available"))
    ),
  messages: [Message.ReceivedEventAttachments],
});
