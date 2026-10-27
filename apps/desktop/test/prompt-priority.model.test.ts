import {
  defaultDesktopPreferences,
  NativeNotificationReply,
  NativeNotificationRequest,
} from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import {
  Arbitrary,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Match,
  Queue,
  Schema,
  Scope,
} from "effect";

import { DesktopError } from "../src/config.js";
import { preparePromptAdmission, startPrompt } from "../src/prompt-machine.js";
import {
  dismissPrompt,
  initialPrompt,
  snoozePrompt,
} from "../src/prompt-model.js";
import {
  nativeEvent,
  nativeHarness,
  nativeRef,
  nativeSnapshot,
} from "./native-notifications-fixture.js";

const meeting: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: nativeEvent.conferenceUrl,
  end: nativeEvent.end,
  hasLocation: false,
  hasParticipants: true,
  key: nativeEvent.key,
  responseStatus: "accepted",
  start: nativeEvent.start,
  title: nativeEvent.title,
};

it.effect.each([
  ["snooze", "last-card"],
  ["dismiss", "last-card"],
  ["snooze", "subset"],
  ["dismiss", "subset"],
] as const)(
  "%s removal keeps owner only for a nonempty %s result",
  ([action, mode]) =>
    Effect.sync(() => {
      const other = {
        ...meeting,
        key: { ...meeting.key, eventId: "remaining-card" },
      };

      const remaining = mode === "subset" ? [other] : [];
      const events = [meeting, ...remaining];
      const owner = { lease: "removal-lease", personId: "removal-person" };

      const context = {
        ...initialPrompt({
          now: 0,
          preferences: defaultDesktopPreferences(),
          snapshot: { ...nativeSnapshot(), events },
        }),
        visible: events,
        visibleOwner: owner,
      };

      const result =
        action === "snooze"
          ? snoozePrompt(context, meeting.key, 0)
          : dismissPrompt(context, meeting.key);

      expect(result.visible).toEqual(remaining);
      expect(result.visibleOwner).toBe(mode === "subset" ? owner : null);
    })
);

it.effect.each(["accepted", "refused"] as const)(
  "real prompt %s presentation determines ordinary-reminder ownership",
  (outcome) =>
    Effect.gen(function* promptOwnership() {
      const preferences = defaultDesktopPreferences();

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: () =>
            outcome === "accepted"
              ? Effect.void
              : Effect.fail(
                  new DesktopError({ message: "Prompt presentation refused" })
                ),
        },
        { now: 0, preferences, snapshot: nativeSnapshot() }
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );
      const snapshot = { ...nativeSnapshot(), events: [meeting] };

      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        (current, permit) =>
          preparePromptAdmission(
            actor,
            { now: 0, preferences, snapshot: current },
            "priority",
            permit,
            "presented"
          )
      );

      const result = yield* h.prepare(snapshot, "one");
      yield* Schema.decodeEffect(NativeNotificationReply)(result);
      expect(result.status).toBe("ready");
      yield* waitFor(actor, (state) =>
        state.matches(outcome === "accepted" ? "visible" : "idle")
      ).pipe(Effect.orDie);
      expect(result.claims).toEqual(
        outcome === "accepted"
          ? [{ key: meeting.key, start: meeting.start }]
          : []
      );
      expect(h.notifications).toHaveLength(0);
    }).pipe(Effect.scoped)
);

it.effect.each([
  "menu-off",
  "disabled",
  "outside-window",
  "no-conference",
  "no-participants",
  "all-day",
  "declined",
  "dismissed",
] as const)("%s does not claim ordinary reminder ownership", (mode) =>
  Effect.gen(function* ineligibleOwnership() {
    const preferences = {
      ...defaultDesktopPreferences(),
      menuBar: mode !== "menu-off",
      promptMinutes: mode === "disabled" ? null : (1 as const),
    };

    const event = {
      ...meeting,
      allDay: mode === "all-day",
      conferenceUrl: mode === "no-conference" ? null : meeting.conferenceUrl,
      hasParticipants: mode !== "no-participants",
      responseStatus:
        mode === "declined" ? ("declined" as const) : ("accepted" as const),
    };

    const now = mode === "outside-window" ? -120_000 : 0;

    const actor = yield* startPrompt(
      { close: Effect.void, present: () => Effect.void },
      { now, preferences, snapshot: nativeSnapshot() }
    );

    yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
      Effect.orDie
    );
    const snapshot = { ...nativeSnapshot(), events: [event] };

    if (mode === "dismissed") {
      yield* send(actor, { now, preferences, snapshot, type: "Input" });
      yield* waitFor(actor, (state) => state.matches("visible")).pipe(
        Effect.orDie
      );
      yield* send(actor, { key: meeting.key, type: "Dismiss" });
      yield* waitFor(actor, (state) => state.matches("idle")).pipe(
        Effect.orDie
      );
    }

    const h = yield* nativeHarness(
      Effect.void,
      Effect.void,
      (current, permit) =>
        preparePromptAdmission(
          actor,
          { now, preferences, snapshot: current },
          "ineligible",
          permit,
          "presented"
        )
    );

    const result = yield* h.prepare(snapshot, "one");
    yield* Schema.decodeEffect(NativeNotificationReply)(result);
    expect(result.status).toBe("ready");
    expect(result.claims).toEqual([]);
  }).pipe(Effect.scoped)
);

it.effect.each([
  "accepted",
  "refused",
  "invalidate",
  "reset",
  "dispose",
  "superseded",
  "person",
  "close",
] as const)(
  "unsettled prompt work followed by %s keeps admission cancellable outside the serial permit",
  (mode) =>
    Effect.gen(function* unsettledOwnership() {
      const entered = yield* Queue.unbounded<boolean>();
      const finish = yield* Deferred.make<boolean>();
      const preferences = defaultDesktopPreferences();
      const permits: { active: boolean }[] = [];

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: () =>
            Queue.offer(entered, true).pipe(
              Effect.andThen(Deferred.await(finish)),
              Effect.andThen(
                mode === "refused"
                  ? Effect.fail(
                      new DesktopError({ message: "Refused after work began" })
                    )
                  : Effect.void
              )
            ),
        },
        { now: 0, preferences, snapshot: nativeSnapshot() }
      );

      yield* waitFor(actor, (state) => state.matches("idle")).pipe(
        Effect.orDie
      );

      const owned = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(owned, Exit.void));

      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        (snapshot, permit) => {
          permits.push(permit);

          return preparePromptAdmission(
            actor,
            { now: 0, preferences, snapshot },
            "held",
            permit,
            "presented"
          );
        }
      ).pipe(Effect.provideService(Scope.Scope, owned));

      const snapshot = { ...nativeSnapshot(), events: [meeting] };
      const pending = yield* h.prepare(snapshot, "one").pipe(Effect.forkChild);
      yield* Queue.take(entered);
      yield* waitFor(actor, (state) => state.matches("presenting")).pipe(
        Effect.orDie
      );
      expect(permits.map((permit) => permit.active)).toEqual([true]);

      const independent = yield* h.manager.request(
        NativeNotificationRequest.cases.Close.make({ refs: [], version: 1 })
      );

      expect(independent.status).toBe("ready");
      yield* Match.value(mode).pipe(
        Match.when("invalidate", () => h.manager.invalidate),
        Match.when("reset", () => h.manager.reset("lease")),
        Match.when("dispose", () => Scope.close(owned, Exit.void)),
        Match.when("superseded", () => h.manager.install(nativeSnapshot(2))),
        Match.when("person", () =>
          h.manager.install({
            events: [meeting],
            notificationAgenda: {
              deliveries: [],
              events: [],
              lease: "lease",
              personId: "another-person",
              revision: 2,
              version: 1,
            },
          })
        ),
        Match.when("close", () =>
          h.manager
            .request(
              NativeNotificationRequest.cases.Close.make({
                refs: [nativeRef()],
                version: 1,
              })
            )
            .pipe(Effect.asVoid)
        ),
        Match.orElse(() => Deferred.succeed(finish, true).pipe(Effect.asVoid))
      );
      const result = yield* Fiber.join(pending);
      yield* Schema.decodeEffect(NativeNotificationReply)(result);
      expect(result.status).toBe(
        Match.value(mode).pipe(
          Match.when("accepted", () => "ready"),
          Match.when("refused", () => "ready"),
          Match.when("superseded", () => "superseded"),
          Match.orElse(() => "refused")
        )
      );
      expect(result.claims).toEqual(
        mode === "accepted" ? [{ key: meeting.key, start: meeting.start }] : []
      );
      expect(permits.map((permit) => permit.active)).toEqual([false]);
      expect(h.notifications).toHaveLength(0);
    }).pipe(Effect.scoped)
);

it.effect.each(["same-person", "other-person"] as const)(
  "an already visible prompt from %s owns only its own person after a refused presentation",
  (identity) =>
    Effect.gen(function* visibleIdentityOwnership() {
      const preferences = defaultDesktopPreferences();
      const snapshot = { ...nativeSnapshot(), events: [meeting] };
      const agenda = snapshot.notificationAgenda;
      expect(agenda).toBeDefined();

      if (agenda === undefined) {
        return;
      }

      const presentations: string[] = [];

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: () =>
            Effect.sync(() => presentations.push("present")).pipe(
              Effect.flatMap((count) =>
                count === 1
                  ? Effect.void
                  : Effect.fail(
                      new DesktopError({ message: "Redisplay refused" })
                    )
              )
            ),
        },
        { now: 0, preferences, snapshot }
      );

      yield* waitFor(actor, (state) => state.matches("visible")).pipe(
        Effect.orDie
      );

      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        (current, permit) =>
          preparePromptAdmission(
            actor,
            { now: 0, preferences, snapshot: current },
            "visible-identity",
            permit,
            "presented"
          )
      );

      const result = yield* h.prepare(
        {
          ...snapshot,
          notificationAgenda: {
            ...agenda,
            personId:
              identity === "same-person" ? agenda.personId : "other-person",
            revision: 2,
          },
        },
        "one"
      );

      yield* Schema.decodeEffect(NativeNotificationReply)(result);
      expect(result.status).toBe("ready");
      expect(result.claims).toEqual(
        identity === "same-person"
          ? [{ key: meeting.key, start: meeting.start }]
          : []
      );
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "ordinary P49 Input histories preserve the supplied clock without an admission",
  {
    history: Arbitrary.schema(
      Schema.Array(
        Schema.Int.check(
          Schema.isBetween({ maximum: 120_000, minimum: -120_000 })
        )
      )
    ),
  },
  ({ history }) =>
    Effect.gen(function* ordinaryInputHistory() {
      const preferences = defaultDesktopPreferences();
      const snapshot = nativeSnapshot();

      const actor = yield* startPrompt(
        { close: Effect.void, present: () => Effect.void },
        { now: 0, preferences, snapshot }
      );

      yield* waitFor(actor, (state) => state.matches("idle")).pipe(
        Effect.orDie
      );

      const observed: number[] = [];
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          actor.subscribe((state) => {
            observed.push(state.context.now);
          })
        ),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
      let barrier = 1_000_000;

      for (const now of history) {
        observed.length = 0;
        const marker = barrier + 1;
        barrier = marker;
        yield* send(actor, { now, preferences, snapshot, type: "Input" });
        yield* send(actor, { now: marker, type: "Tick" });
        yield* waitFor(actor, (state) => state.context.now === marker).pipe(
          Effect.orDie
        );
        expect(observed).toContain(now);
      }
    }).pipe(Effect.scoped)
);

it.effect.each(["person", "lease", "two-admissions", "same-owner"] as const)(
  "accepted presentation ownership survives %s header changes without lending another owner's claim",
  (history) =>
    Effect.gen(function* acceptedPresentationOwnerHistory() {
      const preferences = defaultDesktopPreferences();
      const initial = { ...nativeSnapshot(), events: [meeting] };
      const agenda = initial.notificationAgenda;
      expect(agenda).toBeDefined();

      if (agenda === undefined) {
        return;
      }

      const entered = yield* Queue.unbounded<boolean>();
      const processed = yield* Queue.unbounded<string>();
      const refuse = yield* Deferred.make<boolean>();
      const presentations: string[] = [];

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: () =>
            Effect.sync(() => presentations.push("present")).pipe(
              Effect.flatMap((count) =>
                count === 1
                  ? Effect.void
                  : Queue.offer(entered, true).pipe(
                      Effect.andThen(Deferred.await(refuse)),
                      Effect.andThen(
                        Effect.fail(
                          new DesktopError({
                            message: "B presentation refused",
                          })
                        )
                      )
                    )
              )
            ),
        },
        { now: 0, preferences, snapshot: initial }
      );

      yield* waitFor(actor, (state) => state.matches("visible")).pipe(
        Effect.orDie
      );

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          actor.on("InputProcessed", (notice) => {
            if (notice.attempt !== null) {
              Queue.offerUnsafe(processed, notice.attempt);
            }
          })
        ),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );

      const current = {
        ...initial,
        notificationAgenda: {
          ...agenda,
          lease: history === "lease" ? "B-lease" : agenda.lease,
          personId:
            history === "person" || history === "two-admissions"
              ? "B-person"
              : agenda.personId,
          revision: 2,
        },
      };

      const permits: { active: boolean }[] = [];

      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        (snapshot, permit) => {
          const attempt = `owner-${permits.push(permit)}`;

          return preparePromptAdmission(
            actor,
            { now: 0, preferences, snapshot },
            attempt,
            permit,
            "presented"
          );
        }
      );

      if (history === "lease") {
        yield* h.manager.reset(current.notificationAgenda.lease);
      }

      if (history !== "two-admissions") {
        yield* send(actor, { snapshot: current, type: "Agenda" });
        yield* Queue.take(entered);
      }

      const first = yield* h.prepare(current, "one").pipe(Effect.forkChild);
      yield* Queue.take(processed);

      if (history === "two-admissions") {
        yield* Queue.take(entered);
      }

      const second =
        history === "two-admissions"
          ? yield* h.prepare(current, "one").pipe(Effect.forkChild)
          : undefined;

      if (second !== undefined) {
        yield* Queue.take(processed);
      }

      yield* send(actor, { now: 1, type: "Tick" });
      yield* waitFor(actor, (state) => state.context.now === 1).pipe(
        Effect.orDie
      );

      if (history === "same-owner") {
        const reply = yield* Fiber.join(first).pipe(
          Effect.flatMap(Schema.decodeEffect(NativeNotificationReply))
        );

        expect(reply.status).toBe("ready");
        expect(reply.claims).toEqual([
          { key: meeting.key, start: meeting.start },
        ]);
        expect(actor.getSnapshot().matches("presenting")).toBe(true);
      } else {
        expect(permits.map((permit) => permit.active)).toEqual(
          second === undefined ? [true] : [true, true]
        );
      }

      const unrelated = yield* h.manager.request(
        NativeNotificationRequest.cases.Close.make({ refs: [], version: 1 })
      );

      expect(unrelated.status).toBe("ready");

      yield* Deferred.succeed(refuse, true);

      if (history !== "same-owner") {
        const reply = yield* Fiber.join(first).pipe(
          Effect.flatMap(Schema.decodeEffect(NativeNotificationReply))
        );

        expect(reply.status).toBe("ready");
        expect(reply.claims).toEqual([]);

        if (second !== undefined) {
          const secondReply = yield* Fiber.join(second).pipe(
            Effect.flatMap(Schema.decodeEffect(NativeNotificationReply))
          );

          expect(secondReply.status).toBe("ready");
          expect(secondReply.claims).toEqual([]);
        }
      }

      expect(permits.every((permit) => !permit.active)).toBe(true);
      yield* waitFor(actor, (state) => state.matches("idle")).pipe(
        Effect.orDie
      );
    }).pipe(Effect.scoped)
);
