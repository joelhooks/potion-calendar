import {
  NativeNotificationNotice,
  NativeNotificationRequest,
  NativeReminderSnoozeChoice,
  nativeReminderSnoozeMinutes,
  desktopWire,
  nativeNotificationWire,
  defaultDesktopPreferences,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Deferred, Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";

import { notificationPhase } from "../src/native-notification-machine.js";
import type { NativeNotificationSignal } from "../src/native-notifications.js";
import {
  nativeNotificationActions,
  selectedNotificationAction,
} from "../src/native-notifications.js";
import { preparePromptAdmission, startPrompt } from "../src/prompt-machine.js";
import {
  nativeEvent,
  nativeHarness,
  nativeRef,
  nativeSnapshot,
} from "./native-notifications-fixture.js";

it.effect.each(["ordinary", "invite", "snoozed"] as const)(
  "wire-decoded main and real prompt admission admit only the %s ended delivery with due snooze authority",
  (kind) =>
    Effect.gen(function* endedWireRecipient() {
      const now = nativeEvent.end + 10_000;
      yield* TestClock.setTime(now);
      const preferences = defaultDesktopPreferences();

      const prompt = yield* startPrompt(
        { close: Effect.void, present: () => Effect.void },
        { now, preferences, snapshot: { events: [] } }
      );

      const claims: (readonly { readonly start: number }[])[] = [];

      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        (snapshot, permit) =>
          preparePromptAdmission(
            prompt,
            { now, preferences, snapshot },
            `ended-${kind}`,
            permit,
            "presented"
          ).pipe(
            Effect.tap((value) =>
              Effect.sync(() => {
                claims.push(value);
              })
            )
          ),
        Effect.void,
        true
      );

      const snapshot = nativeSnapshot(
        1,
        "ended-wire",
        kind === "invite" ? "invite" : "reminder"
      );

      const agenda = snapshot.notificationAgenda;

      if (agenda === undefined) {
        return yield* Effect.die("Missing ended wire agenda");
      }

      const input = {
        ...snapshot,
        notificationAgenda: {
          ...agenda,
          deliveries: agenda.deliveries.map((delivery) =>
            kind === "snoozed" ? { ...delivery, snoozedUntil: now } : delivery
          ),
        },
      };

      const decoded = yield* Schema.decodeEffect(desktopWire.agenda)(
        yield* Schema.encodeEffect(desktopWire.agenda)(input)
      );

      const prepared = yield* h.prepare(decoded, "ended-wire");
      expect(prepared.status).toBe("ready");
      expect(claims).toEqual([[]]);

      const message = NativeNotificationRequest.cases.Show.make({
        ref: nativeRef("ended-wire", kind === "invite" ? "invite" : "reminder"),
        version: 1,
      });

      const request = yield* Schema.decodeEffect(
        nativeNotificationWire.request
      )(yield* Schema.encodeEffect(nativeNotificationWire.request)(message));

      const result = yield* h.manager.request(request);
      expect(result.status).toBe(kind === "snoozed" ? "ready" : "refused");
      expect(h.notifications).toHaveLength(kind === "snoozed" ? 1 : 0);
      expect(h.notifications[0]?.shown ?? 0).toBe(kind === "snoozed" ? 1 : 0);

      if (kind === "snoozed") {
        expect(h.notifications[0]?.options.silent).toBe(false);
      }

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.prop(
  "native action lists retain contextual order and expose every duration without truncation",
  [Schema.Finite],
  ([now]) => {
    const legacy = nativeNotificationActions(nativeEvent, "reminder");
    const actions = nativeNotificationActions(nativeEvent, "reminder", now);
    expect(actions.slice(0, legacy.length)).toEqual(legacy);
    expect(actions.slice(legacy.length).map((item) => item.action)).toEqual([
      ...nativeReminderSnoozeMinutes,
      ...(now < nativeEvent.start ? ["start"] : []),
    ]);
    expect(actions.find((item) => item.action === 1440)?.text).toBe(
      "Snooze 1,440 minutes"
    );
    expect(nativeNotificationActions(nativeEvent, "invite", now)).toEqual(
      nativeNotificationActions(nativeEvent, "invite")
    );
  }
);

it.effect.prop(
  "every native snooze action index emits its exact choice once and waits for planner acknowledgement",
  { choice: Arbitrary.schema(NativeReminderSnoozeChoice) },
  ({ choice }) =>
    Effect.gen(function* indexedChoice() {
      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        () => Effect.succeed([]),
        Effect.void,
        true
      );

      yield* h.prepare();
      const displayed = yield* h.show();
      expect(h.notices.filter(NativeNotificationNotice.guards.Shown)).toEqual(
        []
      );
      expect(
        h.notices.filter(NativeNotificationNotice.guards.Ready)
      ).toMatchObject([{ ref: displayed.ref }]);

      const actions = h.notifications[0]?.options.actions ?? [];
      const index = actions.findIndex((item) => item.action === choice);
      expect(index).toBeGreaterThanOrEqual(3);
      yield* h.drive(0, { index, kind: "action" });
      yield* h.drive(0, { index, kind: "action" });
      yield* h.drive(0, { kind: "close" });

      const selected = h.notices.filter(
        NativeNotificationNotice.guards.SnoozeSelected
      );

      expect(selected).toHaveLength(1);
      expect(selected[0]).toEqual(
        NativeNotificationNotice.cases.SnoozeSelected.make({
          choice,
          ref: displayed.ref ?? nativeRef(),
        })
      );
      expect(h.notifications[0]?.closed).toBe(0);
      expect(h.joins).toEqual([]);
      expect(h.opens).toEqual([]);
      expect(h.focus).toEqual([]);

      if (displayed.ref === undefined) {
        return yield* Effect.die("Missing displayed native reference");
      }

      expect(
        (yield* h.manager.request(
          NativeNotificationRequest.cases.SnoozeResult.make({
            outcome: "accepted",
            ref: displayed.ref,
            version: 1,
          })
        )).status
      ).toBe("ready");
      expect(h.notifications[0]?.closed).toBe(1);
      yield* h.drive(0, { index, kind: "action" });
      expect(
        h.notices.filter(NativeNotificationNotice.guards.SnoozeSelected)
      ).toHaveLength(1);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each([
  undefined,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  999_999,
])(
  "invalid native action index %s does not consume or write a notification",
  (index) =>
    Effect.gen(function* invalidIndex() {
      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        () => Effect.succeed([]),
        Effect.void,
        true
      );

      yield* h.prepare();
      yield* h.show();
      const actions = h.notifications[0]?.options.actions ?? [];

      const signal: NativeNotificationSignal =
        index === undefined ? { kind: "action" } : { index, kind: "action" };

      expect(selectedNotificationAction({ actions }, signal)).toBeUndefined();
      yield* h.drive(0, signal);
      expect(h.notices.map((notice) => notice._tag)).toEqual(["Ready"]);
      expect(h.notifications[0]?.closed).toBe(0);
      yield* h.drive(0, {
        index: actions.findIndex((item) => item.action === 1),
        kind: "action",
      });
      expect(
        h.notices.filter(NativeNotificationNotice.guards.SnoozeSelected)
      ).toHaveLength(1);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.prop(
  "native snooze presentation histories cannot leave a retired phase or accept actions while awaiting the writer",
  [
    Schema.Array(
      Schema.Literals(["SNOOZE", "ACT", "SHOW", "RESUME", "CLOSE", "FAIL"])
    ),
  ],
  ([history]) => {
    let phase: ReturnType<typeof notificationPhase> = "showing";

    for (const event of history) {
      const previous = phase;
      phase = notificationPhase(phase, event);

      if (previous === "retired" || previous === "failed") {
        expect(phase).toBe(previous);
      }

      if (
        previous === "snoozing" &&
        (event === "ACT" || event === "SHOW" || event === "SNOOZE")
      ) {
        expect(phase).toBe("snoozing");
      }
    }
  }
);

it.effect.each(["refused", "failed"] as const)(
  "a matching %s planner result permits retry without a deadline owner in native",
  (outcome) =>
    Effect.gen(function* retryChoice() {
      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        () => Effect.succeed([]),
        Effect.void,
        true
      );

      yield* h.prepare();
      const displayed = yield* h.show();

      if (displayed.ref === undefined) {
        return yield* Effect.die("Missing native reference");
      }

      yield* h.drive(0, { index: 3, kind: "action" });
      expect(
        (yield* h.manager.request(
          NativeNotificationRequest.cases.SnoozeResult.make({
            outcome,
            ref: { ...displayed.ref, personId: "other-person" },
            version: 1,
          })
        )).status
      ).toBe("refused");
      yield* h.drive(0, { index: 3, kind: "action" });
      expect(
        h.notices.filter(NativeNotificationNotice.guards.SnoozeSelected)
      ).toHaveLength(1);
      yield* h.manager.request(
        NativeNotificationRequest.cases.SnoozeResult.make({
          outcome,
          ref: displayed.ref,
          version: 1,
        })
      );
      expect(h.notifications).toHaveLength(2);
      expect(h.notifications[0]?.closed).toBe(1);
      expect(h.notifications[1]?.options.silent).toBe(true);
      yield* h.drive(0, { index: 3, kind: "action" });
      expect(
        h.notices.filter(NativeNotificationNotice.guards.SnoozeSelected)
      ).toHaveLength(1);
      yield* h.drive(1, { index: 3, kind: "action" });
      expect(
        h.notices.filter(NativeNotificationNotice.guards.SnoozeSelected)
      ).toHaveLength(2);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "a fresh due snooze alerts even when an ordinary handle for the same occurrence was silently replaced",
  () =>
    Effect.gen(function* freshReturnSound() {
      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        () => Effect.succeed([]),
        Effect.void,
        true
      );

      yield* h.prepare();
      yield* h.show();
      const snapshot = nativeSnapshot(2, "snooze-return");
      const agenda = snapshot.notificationAgenda;

      if (agenda === undefined) {
        return yield* Effect.die("Missing snooze return agenda");
      }

      yield* h.manager.install({
        ...snapshot,
        notificationAgenda: {
          ...agenda,
          deliveries: agenda.deliveries.map((delivery) => ({
            ...delivery,
            snoozedUntil: 0,
          })),
        },
      });
      yield* h.show("snooze-return", "reminder", 2);
      expect(h.notifications).toHaveLength(2);
      expect(h.notifications[1]?.options.silent).toBe(false);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "Until start is rechecked after a delayed native action and removed on the next boundary publication",
  () =>
    Effect.gen(function* startBoundary() {
      const started = yield* Deferred.make<boolean>();
      const released = yield* Deferred.make<boolean>();

      const h = yield* nativeHarness(
        Deferred.succeed(started, true).pipe(
          Effect.andThen(Deferred.await(released))
        ),
        Effect.void,
        () => Effect.succeed([]),
        Effect.void,
        true
      );

      yield* h.prepare();
      yield* h.show();
      const actions = h.notifications[0]?.options.actions ?? [];

      const work = yield* h
        .drive(0, {
          index: actions.findIndex((item) => item.action === "start"),
          kind: "action",
        })
        .pipe(Effect.forkScoped);

      yield* Deferred.await(started);
      yield* TestClock.setTime(nativeEvent.start);
      yield* Deferred.succeed(released, true);
      yield* Fiber.join(work);
      expect(
        h.notices.filter(NativeNotificationNotice.guards.SnoozeSelected)
      ).toEqual([]);
      yield* h.manager.install(nativeSnapshot(2));
      expect(h.notifications).toHaveLength(2);
      expect(
        h.notifications[1]?.options.actions.map((item) => item.action)
      ).not.toContain("start");
      yield* h.drive(0, { index: 3, kind: "action" });
      expect(
        h.notices.filter(NativeNotificationNotice.guards.SnoozeSelected)
      ).toEqual([]);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each(["ordinary", "invite", "snoozed"] as const)(
  "an ended %s occurrence only remains eligible for an explicit due reminder snooze",
  (kind) =>
    Effect.gen(function* endedOccurrence() {
      yield* TestClock.setTime(nativeEvent.end + 60_000);

      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        () => Effect.succeed([]),
        Effect.void,
        true
      );

      const snapshot = nativeSnapshot(
        1,
        "one",
        kind === "invite" ? "invite" : "reminder"
      );

      const agenda = snapshot.notificationAgenda;

      if (agenda === undefined) {
        return yield* Effect.die("Missing native agenda");
      }

      yield* h.prepare({
        ...snapshot,
        notificationAgenda: {
          ...agenda,
          deliveries: agenda.deliveries.map((entry) =>
            kind === "ordinary"
              ? entry
              : { ...entry, snoozedUntil: nativeEvent.end + 1 }
          ),
        },
      });

      const result = yield* h.show(
        "one",
        kind === "invite" ? "invite" : "reminder"
      );

      expect(result.status).toBe(kind === "snoozed" ? "ready" : "refused");
      expect(h.notifications).toHaveLength(kind === "snoozed" ? 1 : 0);

      if (kind === "snoozed") {
        expect(
          h.notifications[0]?.options.actions.map((item) => item.action)
        ).not.toContain("start");
        yield* h.drive(0, { index: 3, kind: "action" });
        expect(
          h.notices.filter(NativeNotificationNotice.guards.SnoozeSelected)
        ).toHaveLength(1);
      }

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);
