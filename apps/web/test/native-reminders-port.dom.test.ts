import type { CalendarEventValue } from "@calendar/calendar/contracts";
import type {
  DesktopBridge,
  NativeNotificationReply,
  NativeNotificationRef,
} from "@calendar/core/desktop-bridge";
import { NativeNotificationRequest } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Queue, Result, Schema, Stream } from "effect";

import { Message, update } from "../src/client/app.js";
import { RemoteEvents } from "../src/client/calendar-state.js";
import { desktopDependencies } from "../src/client/desktop/subscription.js";
import { stepReminder } from "../src/client/reminders/machine.js";
import {
  NotificationFailure,
  NotificationContent,
} from "../src/client/reminders/model.js";
import { routedNotifications } from "../src/client/reminders/native.js";
import { commitReminders } from "../src/client/reminders/update.js";
import {
  nativeInvite,
  nativeReminderModel,
} from "./native-reminders-fixture.js";
import { startedReminders } from "./reminders-fixture.js";

// @effect-diagnostics-next-line asyncFunction:off -- The native bridge fixture's unused foreign Promise methods reject instead of starting another application runtime.
const unexpectedNative = async (): Promise<never> =>
  await Promise.reject(new Error("Unexpected native method"));

const legacy = { shows: 0 };

const browser = {
  close: () => Effect.void,
  observe: () => Stream.empty,
  requestPermission: Effect.succeed("granted" as const),
  show: () =>
    Effect.sync(() => {
      legacy.shows += 1;
    }),
};

type ClaimMode =
  | boolean
  | "wrong-start"
  | "wrong-key"
  | "dismissed"
  | "stale-revision"
  | "superseded-once"
  | "landed-stale-once";

const claimsFor = (
  claim: ClaimMode,
  ref: typeof NativeNotificationRef.Type
) => {
  if (claim === true || claim === "stale-revision") {
    return [{ key: ref.key, start: ref.start }];
  }

  if (claim === "wrong-start") {
    return [{ key: ref.key, start: ref.start + 1 }];
  }

  if (claim === "wrong-key") {
    return [
      { key: { ...ref.key, eventId: "another-occurrence" }, start: ref.start },
    ];
  }

  return [];
};

const connected = Effect.fn("nativePortFixture")(function* connected(
  claim: ClaimMode,
  failed: boolean,
  lease?: string,
  event: CalendarEventValue = nativeInvite
) {
  legacy.shows = 0;
  const fixture = nativeReminderModel(event);
  const currentLease = lease ?? "native-lease";

  const model = {
    ...fixture.model,
    desktop: { ...fixture.model.desktop, notificationLease: currentLease },
  };

  const ref = { ...fixture.ref, lease: currentLease };
  const [active] = model.reminders.context.active;

  if (active === undefined) {
    return yield* Effect.die("Missing fixture notification");
  }

  const content = {
    ...active,
    native: {
      snapshot: desktopDependencies({
        ...model,
        reminders: {
          ...model.reminders,
          context: {
            ...model.reminders.context,
            active: [{ ...active, nativeKind: "reminder" }],
          },
        },
      }).snapshot,
    },
    nativeKind: "reminder" as const,
  };

  const ready = yield* Queue.unbounded<boolean>();
  const requests: (typeof NativeNotificationRequest.Type)[] = [];

  const bridge: DesktopBridge = {
    getSettings: unexpectedNative,
    joinMeeting: unexpectedNative,
    // @effect-diagnostics-next-line asyncFunction:off -- The faithful native bridge fake implements the foreign Promise interface without starting an Effect runtime.
    nativeNotifications: async (request) => {
      requests.push(request);

      if (NativeNotificationRequest.guards.Prepare(request)) {
        if (
          claim === "superseded-once" &&
          requests.filter(NativeNotificationRequest.guards.Prepare).length === 1
        ) {
          return await Promise.resolve({
            claims: [],
            status: "superseded" as const,
            version: 1 as const,
          });
        }

        const authority = request.snapshot.notificationAgenda;

        const reply: typeof NativeNotificationReply.Type = {
          authority: {
            lease: authority?.lease ?? ref.lease,
            personId: authority?.personId ?? ref.personId,
            revision:
              claim === "stale-revision"
                ? (authority?.revision ?? ref.revision) - 1
                : (authority?.revision ?? ref.revision),
          },
          claims: claimsFor(claim, ref),
          status: "ready",
          version: 1,
        };

        return await Promise.resolve(reply);
      }

      if (
        NativeNotificationRequest.guards.Show(request) ||
        NativeNotificationRequest.guards.Replace(request)
      ) {
        const finalStatus = failed ? "failed" : "ready";

        const reply: typeof NativeNotificationReply.Type = {
          claims: [],
          ref: { ...request.ref, generation: 1 },
          status:
            claim === "landed-stale-once" &&
            requests.filter(NativeNotificationRequest.guards.Show).length === 1
              ? "superseded"
              : finalStatus,
          version: 1,
        };

        return await Promise.resolve(reply);
      }

      return await Promise.resolve({ claims: [], status: "ready", version: 1 });
    },
    onAction: () => () => {},
    onNativeNotification: () => {
      Queue.offerUnsafe(ready, true);

      return () => {};
    },
    onSettings: () => () => {},
    publishAgenda: () => {},
    savePreferences: unexpectedNative,
    setStartup: unexpectedNative,
  };

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Object.getOwnPropertyDescriptor(window, "potionDesktop");
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
  const port = routedNotifications(browser);
  yield* port.observe(ref.personId).pipe(Stream.runDrain, Effect.forkScoped);
  yield* Queue.take(ready);

  return { content, model, port, requests };
});

it.effect(
  "actual prompt admission consumes the ordinary proposal without a native or browser duplicate",
  () =>
    Effect.gen(function* promptWins() {
      const h = yield* connected(true, false);
      expect(yield* h.port.show(h.content).pipe(Effect.result)).toEqual(
        Result.fail(new NotificationFailure({ reason: "inactive" }))
      );
      expect(h.requests.map((request) => request._tag)).toEqual(["Prepare"]);
      expect(legacy.shows).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "no prompt claim uses exactly one native display; known native failure never starts browser delivery",
  () =>
    Effect.gen(function* nativeOnly() {
      const h = yield* connected(false, true);
      expect(yield* h.port.show(h.content).pipe(Effect.result)).toEqual(
        Result.fail(new NotificationFailure({ reason: "delivery" }))
      );
      expect(h.requests.map((request) => request._tag)).toEqual([
        "Prepare",
        "Show",
      ]);
      expect(legacy.shows).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.each(["wrong-start", "wrong-key", "dismissed"] as const)(
  "%s prompt membership cannot suppress a legitimate ordinary reminder",
  (claim) =>
    Effect.gen(function* missingAdmission() {
      const h = yield* connected(claim, false);
      expect(
        Result.isSuccess(yield* h.port.show(h.content).pipe(Effect.result))
      ).toBe(true);
      expect(h.requests.map((request) => request._tag)).toEqual([
        "Prepare",
        "Show",
      ]);
      expect(legacy.shows).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "a stale admission authority fails closed without claiming prompt-priority suppression",
  () =>
    Effect.gen(function* staleAdmission() {
      const h = yield* connected("stale-revision", false);
      expect(yield* h.port.show(h.content).pipe(Effect.result)).toEqual(
        Result.fail(new NotificationFailure({ reason: "delivery" }))
      );
      expect(h.requests.map((request) => request._tag)).toEqual(["Prepare"]);
      expect(legacy.shows).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "an admitted current-lease planner delivery fires once across the next publication without browser duplication or loss",
  () =>
    Effect.gen(function* currentLeasePlanner() {
      const h = yield* connected(false, false, "reload-current", {
        ...nativeInvite,
        reminders: {
          overrides: [{ method: "popup", minutes: 0 }],
          useDefault: false,
        },
      });

      const { candidate } = h.content;

      const scan = {
        accepted: Option.some({ origin: "snapshot" as const, request: 1 }),
        candidates: [candidate],
        eventInvites: false,
        native: true as const,
        nativeEnabled: true,
        personId: h.content.personId,
        scope: "reload-scope",
        snoozeRangeReady: undefined,
        type: "NATIVE_SCAN" as const,
        webCards: false,
      };

      const before = stepReminder(startedReminders(), {
        ...scan,
        now: candidate.start - 60_000,
      });

      const due = stepReminder(before, { ...scan, now: candidate.start });
      expect(due.context.deliveries).toHaveLength(1);
      const [delivery] = due.context.deliveries;

      if (delivery === undefined) {
        return yield* Effect.die("Missing planner delivery");
      }

      const model = {
        ...h.model,
        reminders: {
          ...h.model.reminders,
          context: { ...h.model.reminders.context, active: [delivery] },
        },
      };

      const shown = yield* h.port
        .show({
          ...delivery,
          native: { snapshot: desktopDependencies(model).snapshot },
        })
        .pipe(Effect.result);

      expect(Result.isSuccess(shown)).toBe(true);

      const next = stepReminder(due, {
        ...scan,
        accepted: Option.some({ origin: "live" as const, request: 2 }),
        now: candidate.start + 1,
      });

      expect(next.context.deliveries).toEqual([]);
      expect(next.context.fired).toEqual(due.context.fired);
      expect(h.requests.map((request) => request._tag)).toEqual([
        "Prepare",
        "Show",
      ]);

      const prepared = h.requests.find(
        NativeNotificationRequest.guards.Prepare
      );

      expect(prepared?.snapshot.notificationAgenda?.lease).toBe(
        "reload-current"
      );
      expect(legacy.shows).toBe(0);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each(["superseded", "deleted", "landed"] as const)(
  "the planner and routed port retry a %s delivery only once per newer publication without changing fired history",
  (mode) =>
    Effect.gen(function* supersessionRetry() {
      const h = yield* connected(
        mode === "landed" ? "landed-stale-once" : "superseded-once",
        false,
        "retry-lease",
        {
          ...nativeInvite,
          reminders: {
            overrides: [{ method: "popup", minutes: 0 }],
            useDefault: false,
          },
        }
      );

      const { candidate } = h.content;

      const scan = {
        accepted: Option.some({ origin: "snapshot" as const, request: 1 }),
        candidates: [candidate],
        eventInvites: false,
        native: true as const,
        nativeEnabled: true,
        personId: h.content.personId,
        scope: "retry-scope",
        snoozeRangeReady: undefined,
        type: "NATIVE_SCAN" as const,
        webCards: false,
      };

      const before = stepReminder(startedReminders(), {
        ...scan,
        now: candidate.start - 60_000,
      });

      const due = stepReminder(before, { ...scan, now: candidate.start });

      expect(due.context.deliveries).toHaveLength(1);
      const [delivery] = due.context.deliveries;

      if (delivery === undefined) {
        return yield* Effect.die("Missing planner delivery");
      }

      const model = {
        ...h.model,
        reminders: {
          ...h.model.reminders,
          context: {
            ...h.model.reminders.context,
            active: [delivery],
            fired: due.context.fired,
          },
        },
      };

      const content = {
        ...delivery,
        native: { snapshot: desktopDependencies(model).snapshot },
      };

      const first = yield* h.port.show(content).pipe(Effect.result);

      expect(Result.isFailure(first)).toBe(true);

      if (Result.isSuccess(first)) {
        return yield* Effect.void;
      }

      expect(first.failure.reason).toBe("stale");

      const completion = Message.ReminderDeliveryCompleted({
        failure: Option.some(first.failure),
        id: delivery.id,
        personId: delivery.personId,
      });

      const newer = {
        ...model,
        desktop: {
          ...model.desktop,
          notificationRevision: (model.desktop.notificationRevision ?? 0) + 1,
        },
      };

      const current =
        mode === "deleted"
          ? {
              ...newer,
              upcoming: {
                ...newer.upcoming,
                data: RemoteEvents.Success({
                  data: { events: [], versions: [] },
                }),
                reminderEvents: [],
              },
            }
          : newer;

      const retried = update(current, completion);

      const commands = (retried.commands ?? []).filter(
        (command) => command.name === "DeliverReminderNotification"
      );

      expect(commands).toHaveLength(mode === "deleted" ? 0 : 1);

      for (const command of commands) {
        const args = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ notification: NotificationContent })
        )(command.args);

        expect(args.notification.id).toBe(delivery.id);
        expect(
          args.notification.native?.snapshot.notificationAgenda?.revision
        ).toBe(newer.desktop.notificationRevision);
        const shown = yield* h.port.show(args.notification).pipe(Effect.result);

        expect(Result.isSuccess(shown)).toBe(true);
      }

      expect(retried.model.reminders.context.fired).toEqual(due.context.fired);
      expect(update(retried.model, completion).commands ?? []).toEqual([]);
      expect(
        commitReminders(retried.model, retried.model.reminders).commands ?? []
      ).toEqual([]);
      expect(
        h.requests.filter(NativeNotificationRequest.guards.Show)
      ).toHaveLength({ deleted: 0, landed: 2, superseded: 1 }[mode]);
      expect(legacy.shows).toBe(0);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "legacy content still uses today's browser path without inventing native metadata",
  () =>
    Effect.gen(function* oldShell() {
      legacy.shows = 0;
      const { model } = nativeReminderModel();
      const [content] = model.reminders.context.active;

      if (content === undefined) {
        return yield* Effect.die("Missing fixture notification");
      }

      yield* routedNotifications(browser).show({
        ...content,
        native: undefined,
        nativeKind: undefined,
      });
      expect(legacy.shows).toBe(1);

      return yield* Effect.void;
    })
);
