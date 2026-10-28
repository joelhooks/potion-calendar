import {
  defaultDesktopPreferences,
  NativeNotificationRequest,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaSnapshotValue,
  NativeNotificationEventRef,
  NativeNotificationNotice,
  NativeNotificationRef,
} from "@calendar/core/desktop-bridge";
import { Effect, Layer, Queue, Ref } from "effect";

import { DesktopError } from "../src/config.js";
import { runNativeJoin } from "../src/native-join.js";
import { NativeNotifications } from "../src/native-notifications.js";
import type {
  NativeNotificationOptions,
  NativeNotificationPort,
  NativeNotificationSignal,
} from "../src/native-notifications.js";

export const nativeEvent: typeof NativeNotificationEventRef.Type = {
  body: "Today · 9:00 AM–10:00 AM",
  conferenceUrl: "https://meet.example.test/saved",
  end: 600_000,
  key: {
    accountId: "account",
    calendarId: "calendar",
    eventId: "series_20261026T090000Z",
  },
  participantEmails: ["guest@example.test"],
  rsvp: true,
  start: 60_000,
  title: "Saved meeting",
};

export const nativeRef = (
  id = "one",
  kind: "reminder" | "invite" = "reminder",
  revision = 1
): typeof NativeNotificationRef.Type => ({
  generation: 0,
  id,
  key: nativeEvent.key,
  kind,
  lease: "lease",
  personId: "person",
  revision,
  start: nativeEvent.start,
});

export const nativeSnapshot = (
  revision = 1,
  id = "one",
  kind: "reminder" | "invite" = "reminder",
  event = nativeEvent
): AgendaSnapshotValue => ({
  events: [],
  notificationAgenda: {
    deliveries: [{ id, key: event.key, kind, start: event.start }],
    events: [event],
    lease: "lease",
    personId: "person",
    revision,
    version: 1,
  },
});

export const nativeHarness = Effect.fn("nativeNotificationHarness")(
  function* nativeHarness(
    beforeAction: Effect.Effect<void> = Effect.void,
    beforeHandoff: Effect.Effect<void> = Effect.void,
    promptAdmission: NativeNotificationPort["prepare"] = () =>
      Effect.succeed([]),
    beforeAdmissionFinish: Effect.Effect<void> = Effect.void,
    snooze: NativeNotificationPort["snooze"] = false
  ) {
    const tasks = yield* Queue.unbounded<Effect.Effect<void>>();
    const preferences = yield* Ref.make(defaultDesktopPreferences());
    const trusted = yield* Ref.make(true);
    const supported = true;

    const notifications: {
      options: NativeNotificationOptions;
      receive: (signal: NativeNotificationSignal) => void;
      shown: number;
      closed: number;
    }[] = [];

    const notices: (typeof NativeNotificationNotice.Type)[] = [];
    const joins: (typeof NativeNotificationEventRef.Type)[] = [];
    const opens: string[] = [];
    const focus: string[] = [];

    const notificationContext = yield* Layer.build(
      NativeNotifications.layer(
        {
          beforeAction,
          beforeAdmissionFinish,
          create: (options, receive) =>
            Effect.sync(() => {
              const record = { closed: 0, options, receive, shown: 0 };
              notifications.push(record);

              return {
                close: Effect.sync(() => {
                  record.closed += 1;
                }),
                show: Effect.sync(() => {
                  record.shown += 1;
                }),
              };
            }),
          emit: (notice) =>
            Effect.sync(() => {
              notices.push(notice);
            }),
          focus: Effect.sync(() => {
            focus.push("focus");
          }),
          join: (event, authorized) =>
            event.conferenceUrl === null
              ? Effect.void
              : runNativeJoin(
                  { conferenceUrl: event.conferenceUrl, key: event.key },
                  (href) =>
                    beforeHandoff.pipe(
                      Effect.andThen(authorized),
                      Effect.flatMap((allowed) =>
                        allowed
                          ? Effect.sync(() => {
                              joins.push({ ...event, conferenceUrl: href });
                            })
                          : Effect.fail(
                              new DesktopError({
                                message: "Stale native action",
                              })
                            )
                      )
                    )
                ).pipe(Effect.asVoid),
          open: (href, authorized) =>
            beforeHandoff.pipe(
              Effect.andThen(authorized),
              Effect.flatMap((allowed) =>
                allowed
                  ? Effect.sync(() => {
                      opens.push(href);
                    })
                  : Effect.void
              )
            ),
          origin: "https://calendar.example.test",
          preferences: Ref.get(preferences),
          prepare: promptAdmission,
          run: (task) => {
            Queue.offerUnsafe(tasks, task);
          },
          snooze,
          supported,
          trusted: Ref.get(trusted),
        },
        "lease"
      )
    );

    const manager = yield* Effect.service(NativeNotifications).pipe(
      Effect.provide(notificationContext)
    );

    const drive = (index: number, signal: NativeNotificationSignal) =>
      Effect.gen(function* driveSignal() {
        const notification = notifications[index];

        if (notification === undefined) {
          return yield* Effect.die("Missing test notification");
        }

        notification.receive(signal);
        yield* Queue.take(tasks).pipe(Effect.flatten);

        return yield* Effect.void;
      });

    const prepare = (
      snapshot: AgendaSnapshotValue = nativeSnapshot(),
      id?: string
    ) =>
      manager.request(
        NativeNotificationRequest.cases.Prepare.make({
          id,
          snapshot,
          version: 1,
        })
      );

    const show = (
      id = "one",
      kind: "reminder" | "invite" = "reminder",
      revision = 1
    ) =>
      manager.request(
        NativeNotificationRequest.cases.Show.make({
          ref: nativeRef(id, kind, revision),
          version: 1,
        })
      );

    return {
      drive,
      focus,
      joins,
      manager,
      notices,
      notifications,
      opens,
      preferences,
      prepare,
      show,
      trusted,
    };
  }
);
