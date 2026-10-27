import {
  NativeNotificationReply,
  NativeNotificationRequest,
} from "@calendar/core/desktop-bridge";
import type { DesktopBridge } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Match, Option, Queue, Result, Schema, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import { desktopDependencies } from "../src/client/desktop/subscription.js";
import { stepReminder } from "../src/client/reminders/machine.js";
import { routedNotifications } from "../src/client/reminders/native.js";
import {
  nativeInvite,
  nativeReminderModel,
} from "./native-reminders-fixture.js";
import { startedReminders } from "./reminders-fixture.js";

// @effect-diagnostics-next-line asyncFunction:off -- The unused foreign Promise methods reject without creating a second Effect runtime.
const unavailable = async (): Promise<never> =>
  await Promise.reject(new Error("Unexpected bridge method"));

it.prop(
  "handled ordinary offsets remain handled through generated replay and backward-clock histories",
  [
    Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: -3 }))
    ),
  ],
  ([history]) => {
    const fixture = nativeReminderModel({
      ...nativeInvite,
      reminders: {
        overrides: [{ method: "popup", minutes: 0 }],
        useDefault: false,
      },
    });

    const [notification] = fixture.model.reminders.context.active;
    expect(notification).toBeDefined();

    if (notification === undefined) {
      return;
    }

    const scan = {
      accepted: Option.some({ origin: "snapshot" as const, request: 1 }),
      candidates: [notification.candidate, notification.candidate],
      eventInvites: false,
      native: true as const,
      nativeEnabled: true,
      personId: notification.personId,
      scope: "generated-priority-pass",
      snoozeRangeReady: undefined,
      type: "NATIVE_SCAN" as const,
      webCards: false,
    };

    const before = stepReminder(startedReminders(), {
      ...scan,
      now: notification.candidate.start - 60_000,
    });

    const due = stepReminder(before, {
      ...scan,
      now: notification.candidate.start,
    });

    expect(due.context.deliveries).toHaveLength(1);
    expect(due.context.fired).toHaveLength(1);
    let current = due;

    for (const delta of history) {
      current = stepReminder(current, {
        ...scan,
        now: notification.candidate.start + delta * 60_000,
      });
      expect(current.context.deliveries).toEqual([]);
      expect(current.context.fired).toEqual(due.context.fired);
    }
  }
);

it.effect.each([
  "accepted",
  "refused",
  "disabled",
  "different-key",
  "different-start",
  "invite",
  "unavailable",
] as const)(
  "the shared Prepare contract with %s ownership consumes only the current crossed ordinary offset across replay and backward clock",
  (mode) =>
    Effect.gen(function* crossSurfacePass() {
      const fixture = nativeReminderModel({
        ...nativeInvite,
        reminders: {
          overrides: [{ method: "popup", minutes: 0 }],
          useDefault: false,
        },
      });

      const [initial] = fixture.model.reminders.context.active;

      if (initial === undefined) {
        return yield* Effect.die("Missing runtime candidate");
      }

      const scan = {
        accepted: Option.some({ origin: "snapshot" as const, request: 1 }),
        candidates: [initial.candidate],
        eventInvites: false,
        native: true as const,
        nativeEnabled: true,
        personId: initial.personId,
        scope: "priority-runtime",
        snoozeRangeReady: undefined,
        type: "NATIVE_SCAN" as const,
        webCards: false,
      };

      const before = stepReminder(startedReminders(), {
        ...scan,
        now: initial.candidate.start - 60_000,
      });

      const due = stepReminder(before, {
        ...scan,
        now: initial.candidate.start,
      });

      const [proposed] = due.context.deliveries;

      if (proposed === undefined) {
        return yield* Effect.die("Missing crossed offset");
      }

      const delivery =
        mode === "invite"
          ? { ...proposed, nativeKind: "invite" as const }
          : proposed;

      const model = {
        ...fixture.model,
        calendar: { ...fixture.model.calendar, now: initial.candidate.start },
        desktop: { ...fixture.model.desktop, notificationLease: "lease" },
        reminders: { ...due, context: { ...due.context, active: [delivery] } },
      };

      const { snapshot } = desktopDependencies(model);
      expect(snapshot.events.map((event) => event.key)).toEqual([
        {
          accountId: initial.candidate.event.accountId,
          calendarId: initial.candidate.event.calendarId,
          eventId: initial.candidate.event.eventId,
        },
      ]);

      const nativeShows: string[] = [];

      const handle = Effect.fn("PromptPriority.testNativeContract")(
        function* handle(input: typeof NativeNotificationRequest.Type) {
          const request = yield* Schema.decodeEffect(NativeNotificationRequest)(
            input
          );

          return yield* Match.value(request).pipe(
            Match.tag("Prepare", (prepare) => {
              const agenda = prepare.snapshot.notificationAgenda;
              const [event] = prepare.snapshot.events;
              expect(agenda).toBeDefined();
              expect(event).toBeDefined();

              if (agenda === undefined || event === undefined) {
                return Effect.die(
                  "Missing shared Prepare authority or occurrence"
                );
              }

              return Schema.decodeEffect(NativeNotificationReply)({
                authority: {
                  lease: agenda.lease,
                  personId: agenda.personId,
                  revision: agenda.revision,
                },
                claims:
                  mode === "refused" || mode === "disabled"
                    ? []
                    : [
                        {
                          key:
                            mode === "different-key"
                              ? {
                                  ...event.key,
                                  eventId: "another-canonical-occurrence",
                                }
                              : event.key,
                          start:
                            mode === "different-start"
                              ? event.start + 60_000
                              : event.start,
                        },
                      ],
                status: "ready",
                version: 1,
              });
            }),
            Match.tag("Close", () =>
              Schema.decodeEffect(NativeNotificationReply)({
                claims: [],
                status: "ready",
                version: 1,
              })
            ),
            Match.orElse((presentation) =>
              Effect.sync(() => {
                nativeShows.push(presentation.ref.id);
              }).pipe(
                Effect.andThen(
                  Schema.decodeEffect(NativeNotificationReply)({
                    claims: [],
                    ref: { ...presentation.ref, generation: 1 },
                    status: "ready",
                    version: 1,
                  })
                )
              )
            )
          );
        }
      );

      const requests = yield* Queue.unbounded<{
        request: typeof NativeNotificationRequest.Type;
        resolve: (reply: typeof NativeNotificationReply.Type) => void;
      }>();

      const seen: string[] = [];
      yield* Queue.take(requests).pipe(
        Effect.flatMap(({ request, resolve }) =>
          handle(request).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                seen.push(request._tag);
              })
            ),
            Effect.flatMap((reply) =>
              Effect.sync(() => {
                resolve(reply);
              })
            )
          )
        ),
        Effect.forever,
        Effect.forkScoped
      );
      const subscribed = yield* Queue.unbounded<boolean>();

      const bridge: DesktopBridge = {
        getSettings: unavailable,
        joinMeeting: unavailable,
        // @effect-diagnostics-next-line asyncFunction:off -- This fixture adapts the required preload Promise to a queue consumed by the test's existing Effect fiber.
        nativeNotifications: async (request) =>
          // oxlint-disable promise/avoid-new -- This single foreign Promise connects the preload boundary to the queue without starting a runtime.
          // @effect-diagnostics-next-line newPromise:off -- The foreign preload Promise is resolved only by the existing queue worker; no application runtime is started.
          await new Promise((resolve) => {
            Queue.offerUnsafe(requests, { request, resolve });
          }),
        // oxlint-enable promise/avoid-new -- The foreign Promise boundary ends here.
        onAction: () => () => {},
        onNativeNotification: () => {
          Queue.offerUnsafe(subscribed, true);

          return () => {};
        },
        onSettings: () => () => {},
        publishAgenda: () => {},
        savePreferences: unavailable,
        setStartup: unavailable,
      };

      if (mode === "unavailable") {
        Reflect.deleteProperty(bridge, "nativeNotifications");
      }

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = Object.getOwnPropertyDescriptor(
            window,
            "potionDesktop"
          );

          Object.defineProperty(window, "potionDesktop", {
            configurable: true,
            value: bridge,
          });

          return previous;
        }),
        (previous) =>
          Effect.sync(() => {
            if (previous === undefined) {
              Reflect.deleteProperty(window, "potionDesktop");
            } else {
              Object.defineProperty(window, "potionDesktop", previous);
            }
          })
      );
      const browserShows: string[] = [];

      const port = routedNotifications({
        close: () => Effect.void,
        observe: () => Stream.empty,
        requestPermission: Effect.succeed("granted" as const),
        show: (content) =>
          Effect.sync(() => {
            browserShows.push(content.id);
          }),
      });

      yield* port
        .observe(initial.personId)
        .pipe(Stream.runDrain, Effect.forkScoped);

      if (mode !== "unavailable") {
        yield* Queue.take(subscribed);
      }

      const shown = yield* port
        .show({ ...delivery, native: { snapshot } })
        .pipe(Effect.result);

      expect(Result.isFailure(shown)).toBe(
        mode === "accepted" || mode === "unavailable"
      );

      const completed = update(
        model,
        Message.ReminderDeliveryCompleted({
          failure: Result.isFailure(shown)
            ? Option.some(shown.failure)
            : Option.none(),
          id: delivery.id,
          personId: initial.personId,
        })
      );

      expect(completed.model.reminders.context.fired).toEqual(
        due.context.fired
      );
      let history = completed.model.reminders;

      for (const now of [
        initial.candidate.start,
        initial.candidate.start - 60_000,
        initial.candidate.start,
        initial.candidate.start + 1,
      ]) {
        history = stepReminder(history, { ...scan, now });
        expect(history.context.deliveries).toEqual([]);
        expect(history.context.fired).toEqual(due.context.fired);
      }

      expect(seen).toEqual(
        Match.value(mode).pipe(
          Match.when("unavailable", () => []),
          Match.when("accepted", () => ["Prepare"]),
          Match.orElse(() => ["Prepare", "Show"])
        )
      );
      expect(nativeShows).toHaveLength(
        mode === "accepted" || mode === "unavailable" ? 0 : 1
      );
      expect(browserShows).toEqual([]);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);
