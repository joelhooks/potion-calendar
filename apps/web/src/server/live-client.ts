import { Provider } from "@calendar/calendar";
import type {
  CalendarChangedValue,
  CalendarRefValue,
} from "@calendar/calendar";
import type { PushDeliveryValue } from "@calendar/database/google-push";
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import { Effect, Schema } from "effect";

import type { CalendarEnvironment } from "./calendar-environment.js";
import type { CalendarBackendOptions } from "./calendar-runtime.js";
import { calendarSettingsFor } from "./calendar-settings.js";
import { d1CalendarStore } from "./calendar-store.js";
import { LiveCommand, LiveReply } from "./live-protocol.js";
import type { LiveCommandValue } from "./live-protocol.js";
import { LiveOutput, LiveWork } from "./live-work.js";

const failure = () =>
  new Provider({
    message: "Live calendar owner is unavailable",
    operation: "live",
    status: 0,
  });

export const calendarLiveClient = (namespace: DurableObjectNamespace) => {
  const post = Effect.fn("calendarLiveClient.post")(function* post(
    command: LiveCommandValue
  ) {
    const payload = yield* Schema.encodeEffect(Schema.toCodecJson(LiveCommand))(
      command
    ).pipe(Effect.mapError(failure));

    const response = yield* Effect.tryPromise({
      catch: failure,

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

    const document = yield* Effect.tryPromise({
      catch: failure,

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () => response.json(),
    });

    const reply = yield* Schema.decodeUnknownEffect(
      Schema.toCodecJson(LiveReply)
    )(document).pipe(Effect.mapError(failure));

    if (LiveReply.guards.Failure(reply)) {
      return yield* reply.failure;
    }

    return reply.value;
  });

  const synchronize = Effect.fn("calendarLiveClient.synchronize")(
    function* synchronize(personId: string, ref: CalendarRefValue) {
      const reply = yield* post(LiveCommand.cases.Sync.make({ personId, ref }));

      if (!LiveOutput.guards.Calendar(reply)) {
        return yield* failure();
      }

      return reply.result;
    }
  );

  const reconcile = (personId: string) =>
    post(LiveCommand.cases.Reconcile.make({ personId })).pipe(Effect.asVoid);

  const notifyInventory = (personId: string) =>
    post(LiveCommand.cases.NotifyInventory.make({ personId })).pipe(
      Effect.asVoid
    );

  const publish = (personId: string, change: CalendarChangedValue) =>
    post(LiveCommand.cases.Publish.make({ change, personId })).pipe(
      Effect.asVoid,
      Effect.tapError(() =>
        Effect.logWarning("Calendar change publication is unavailable")
      ),
      Effect.ignore
    );

  const enqueue = (
    channel: PushDeliveryValue,
    number: string,
    removed: boolean
  ) =>
    post(
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
      Effect.flatMap((reply) =>
        LiveOutput.guards.Queued(reply)
          ? Effect.succeed(reply.accepted)
          : Effect.fail(failure())
      ),
      Effect.mapError(failure)
    );

  const upgrade = (personId: string, origin: string) =>
    Effect.tryPromise({
      catch: failure,

      // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
      try: () =>
        namespace.getByName(personId).fetch("https://calendar.internal/live", {
          headers: {
            origin,
            upgrade: "websocket",
            "x-calendar-person": personId,
          },
        }),
    });

  const deleteAccount = (personId: string) =>
    post(LiveCommand.cases.DeleteAccount.make({ personId })).pipe(
      Effect.asVoid
    );

  const stopAccount = (personId: string, accountId: string) =>
    post(LiveCommand.cases.StopAccount.make({ accountId, personId })).pipe(
      Effect.asVoid
    );

  return {
    deleteAccount,
    enqueue,
    notifyInventory,
    publish,
    reconcile,
    stopAccount,
    synchronize,
    upgrade,
  };
};

export const liveCalendarOptions = (
  environment: CalendarEnvironment
): CalendarBackendOptions => {
  const live = calendarLiveClient(environment.CALENDAR_LIVE);

  return {
    changesFor: (personId) => ({
      publish: (change) => live.publish(personId, change),
    }),
    deleteAccount: live.deleteAccount,
    maintain: live.reconcile,
    settingsFor: (personId) =>
      calendarSettingsFor(environment.DB, personId, {
        notify: () =>
          live.notifyInventory(personId).pipe(Effect.mapError(failure)),
        stop: (accountId) =>
          live.stopAccount(personId, accountId).pipe(Effect.mapError(failure)),
      }),
    storeFor: (personId) => d1CalendarStore(environment.DB, personId),
    synchronize: live.synchronize,
  };
};
