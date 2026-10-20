import type { CalendarChangedValue } from "@calendar/calendar";
import type { PushDeliveryValue } from "@calendar/database/google-push";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import { Cause, Effect, Schema } from "effect";

import { LiveCommand, LiveReply } from "../../src/server/live-protocol.js";
import type { LiveCommandValue } from "../../src/server/live-protocol.js";
import { LiveOutput, LiveWork } from "../../src/server/live-work.js";

export const nativeLiveCommand = Effect.fn("test.nativeLiveCommand")(
  function* nativeLiveCommand(
    namespace: DurableObjectNamespace,
    command: LiveCommandValue
  ) {
    const payload = yield* Schema.encodeEffect(Schema.toCodecJson(LiveCommand))(
      command
    );

    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(
          cause,
          `Native ${command._tag} command transport failed`
        ),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        namespace
          .getByName(command.personId)
          .fetch("https://calendar.internal/calendar-live", {
            body: JSON.stringify(payload),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
    });

    const document: unknown = yield* Effect.tryPromise({
      catch: (cause) =>
        new Cause.UnknownError(
          cause,
          `Native ${command._tag} command response failed`
        ),
      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => response.json(),
    });

    const reply = yield* Schema.decodeUnknownEffect(
      Schema.toCodecJson(LiveReply)
    )(document);

    if (LiveReply.guards.Failure(reply)) {
      return yield* reply.failure;
    }

    return reply.value;
  }
);

export const nativeLiveClient = (namespace: DurableObjectNamespace) => ({
  enqueue: (channel: PushDeliveryValue, number: string, removed: boolean) =>
    nativeLiveCommand(
      namespace,
      LiveCommand.cases.Push.make({
        channelId: channel.id,
        number,
        personId: channel.personId,
        work:
          channel.kind === "calendarList" || removed
            ? LiveWork.cases.Inventory.make({})
            : LiveWork.cases.Calendar.make({
                accountId: channel.accountId,
                calendarId: channel.calendarId ?? "",
              }),
      })
    ).pipe(
      Effect.map((reply) => LiveOutput.guards.Queued(reply) && reply.accepted)
    ),
  publish: (personId: string, change: CalendarChangedValue) =>
    nativeLiveCommand(
      namespace,
      LiveCommand.cases.Publish.make({ change, personId })
    ).pipe(Effect.asVoid),
  reconcile: (personId: string) =>
    nativeLiveCommand(
      namespace,
      LiveCommand.cases.Reconcile.make({ personId })
    ).pipe(Effect.asVoid),
});
