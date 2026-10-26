import {
  defaultDesktopPreferences,
  NativeNotificationRequest,
} from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Match,
  Queue,
  Ref,
  Result,
  Schema,
  Scope,
} from "effect";
import type { Observer } from "xstate";

import { notificationPhase } from "../src/native-notification-machine.js";
import { nativeNotificationActions } from "../src/native-notifications.js";
import { preparePromptAdmission, startPrompt } from "../src/prompt-machine.js";
import type {
  PromptAdmissionPermitValue,
  PromptInput,
} from "../src/prompt-model.js";
import {
  nativeEvent,
  nativeHarness,
  nativeRef,
  nativeSnapshot,
} from "./native-notifications-fixture.js";

it.prop(
  "native action histories leave a claimed or retired presentation terminal for further actions",
  [Schema.Array(Schema.Literals(["ACT", "SHOW", "CLOSE", "FAIL"]))],
  ([history]) => {
    let phase: ReturnType<typeof notificationPhase> = "showing";
    let terminal = false;
    let acted = false;

    for (const event of history) {
      const previous = phase;
      phase = notificationPhase(phase, event);

      if (terminal) {
        expect(phase).toBe(previous);
      }

      if (event === "ACT" && !terminal) {
        acted = true;
      }

      if (acted && !terminal && event === "SHOW") {
        expect(phase).toBe("acting");
      }

      terminal = phase === "retired" || phase === "failed";
    }
  }
);

it.effect(
  "native reminders publish saved title timing and three contextual actions once across duplicate show and callback replay",
  () =>
    Effect.gen(function* once() {
      const h = yield* nativeHarness();
      yield* h.prepare();
      const first = yield* h.show();
      yield* h.show();
      expect(h.notifications).toHaveLength(1);
      expect(h.notifications[0]?.options).toMatchObject({
        body: nativeEvent.body,
        hasReply: false,
        silent: false,
        title: nativeEvent.title,
      });
      expect(
        h.notifications[0]?.options.actions.map((action) => action.text)
      ).toEqual(["Join", "Email participants", "Show event"]);
      yield* h.drive(0, { kind: "show" });
      yield* h.drive(0, { index: 0, kind: "action" });
      yield* h.drive(0, { index: 0, kind: "action" });
      yield* h.show();
      expect(h.joins).toEqual([nativeEvent]);
      expect(h.notifications).toHaveLength(1);
      expect(first.ref?.key).toEqual(nativeEvent.key);
      expect(h.notices.map((notice) => notice._tag)).toEqual([
        "Shown",
        "ActionSelected",
      ]);
    }).pipe(Effect.scoped)
);

it.effect.each(["accepted", "declined", "tentative"] as const)(
  "invitation %s preserves the exact occurrence and immutable five-action mapping",
  (response) =>
    Effect.gen(function* invitation() {
      const h = yield* nativeHarness();
      yield* h.prepare(nativeSnapshot(1, "one", "invite"));
      yield* h.show("one", "invite");
      const options = h.notifications[0]?.options;
      expect(options?.title).toBe("Invite: Saved meeting");
      expect(options?.actions.map((action) => action.text)).toEqual([
        "Yes",
        "No",
        "Maybe",
        "Email participants",
        "Show event",
      ]);
      yield* h.drive(0, {
        index: ["accepted", "declined", "tentative"].indexOf(response),
        kind: "action",
      });
      expect(h.notices.map((notice) => notice._tag)).toEqual([
        "ActionSelected",
      ]);
      expect(h.notices).toMatchObject([
        {
          action: response,
          ref: { key: nativeEvent.key, kind: "invite" },
        },
      ]);
      expect(h.opens).toEqual([]);
      expect(h.joins).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "replacement uses a new generation and silence while retained callbacks and stale Close cannot target its action map",
  () =>
    Effect.gen(function* replacement() {
      const h = yield* nativeHarness();
      yield* h.prepare();
      const original = yield* h.show();

      const changed = {
        ...nativeEvent,
        conferenceUrl: null,
        title: "Updated meeting",
      };

      yield* h.prepare(nativeSnapshot(2, "two", "reminder", changed));
      yield* h.show("two", "reminder", 2);
      expect(h.notifications).toHaveLength(2);
      expect(h.notifications[0]?.closed).toBe(1);
      expect(h.notifications[1]?.options.silent).toBe(true);
      expect(h.notifications[1]?.options.id).not.toBe(
        h.notifications[0]?.options.id
      );
      yield* h.drive(0, { index: 0, kind: "action" });

      if (original.ref !== undefined) {
        yield* h.manager.request(
          NativeNotificationRequest.cases.Close.make({
            refs: [original.ref],
            version: 1,
          })
        );
      }

      expect(h.notifications[1]?.closed).toBe(0);
      yield* h.drive(1, { index: 0, kind: "action" });
      expect(h.joins).toEqual([]);
      expect(h.opens).toEqual([
        "mailto:guest@example.test?subject=Updated%20meeting",
      ]);
    }).pipe(Effect.scoped)
);

it.effect(
  "replacement during an active action revokes the old handoff before the real child completes",
  () =>
    Effect.gen(function* actionRace() {
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();

      const h = yield* nativeHarness(
        Deferred.succeed(entered, true).pipe(
          Effect.andThen(Deferred.await(release).pipe(Effect.asVoid))
        )
      );

      yield* h.prepare();
      yield* h.show();

      const action = yield* h
        .drive(0, { index: 0, kind: "action" })
        .pipe(Effect.forkChild);

      yield* Deferred.await(entered);
      yield* h.prepare(nativeSnapshot(2, "two"));
      yield* h.show("two", "reminder", 2);
      yield* Deferred.succeed(release, true);
      yield* Fiber.join(action);
      expect(h.joins).toEqual([]);
      expect(h.notifications).toHaveLength(2);
      expect(h.notifications[1]?.closed).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.each([
  "missing",
  "retimed",
  "person",
  "lease",
  "menu",
  "frame",
] as const)("native current authority refuses %s action targets", (change) =>
  Effect.gen(function* stale() {
    const h = yield* nativeHarness();
    yield* h.prepare();
    yield* h.show();

    if (change === "menu") {
      yield* Ref.update(h.preferences, (value) => ({
        ...value,
        menuBar: false,
      }));
    } else if (change === "frame") {
      yield* Ref.set(h.trusted, false);
    } else if (change === "lease") {
      yield* h.manager.reset("new-lease");
    } else {
      const snapshot = nativeSnapshot(2);
      const agenda = snapshot.notificationAgenda;

      if (agenda === undefined) {
        return yield* Effect.die("Missing fixture authority");
      }

      yield* h.manager.install({
        ...snapshot,
        notificationAgenda: {
          ...agenda,
          events:
            change === "missing"
              ? []
              : [
                  {
                    ...nativeEvent,
                    start:
                      change === "retimed"
                        ? nativeEvent.start + 1
                        : nativeEvent.start,
                  },
                ],
          personId: change === "person" ? "other-person" : "person",
        },
      });
    }

    yield* h.drive(0, { index: 0, kind: "action" });
    expect(h.joins).toEqual([]);
    expect(h.opens).toEqual([]);
    expect(h.focus).toEqual([]);

    return yield* Effect.void;
  }).pipe(Effect.scoped)
);

it.effect(
  "a replacement while the real Join recipient child waits cannot open or resolve the replacement generation",
  () =>
    Effect.gen(function* queuedRecipient() {
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();

      const h = yield* nativeHarness(
        Effect.void,
        Deferred.succeed(entered, true).pipe(
          Effect.andThen(Deferred.await(release).pipe(Effect.asVoid))
        )
      );

      yield* h.prepare();
      yield* h.show();

      const action = yield* h
        .drive(0, { index: 0, kind: "action" })
        .pipe(Effect.forkChild);

      yield* Deferred.await(entered);
      yield* h.prepare(nativeSnapshot(2, "two"));
      yield* h.show("two", "reminder", 2);
      yield* Deferred.succeed(release, true);
      yield* Fiber.join(action);
      expect(h.joins).toEqual([]);
      expect(h.notices).toEqual([]);
      expect(h.notifications[1]?.closed).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "an OS close after an action claim does not cancel the real recipient",
  () =>
    Effect.gen(function* closeAfterAction() {
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();

      const h = yield* nativeHarness(
        Effect.void,
        Deferred.succeed(entered, true).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.asVoid
        )
      );

      yield* h.prepare();
      yield* h.show();

      const action = yield* h
        .drive(0, { index: 0, kind: "action" })
        .pipe(Effect.forkChild);

      yield* Deferred.await(entered);
      yield* h.drive(0, { kind: "close" });
      yield* Deferred.succeed(release, true);
      yield* Fiber.join(action);
      expect(h.joins).toEqual([nativeEvent]);
      expect(h.notices.map((notice) => notice._tag)).toEqual([
        "Closed",
        "ActionSelected",
      ]);
      expect(h.notifications[0]?.closed).toBe(1);
    }).pipe(Effect.scoped)
);

it.effect(
  "current notification authority revision and admitted delivery identity reject forged or out-of-order show",
  () =>
    Effect.gen(function* revisionFence() {
      const h = yield* nativeHarness();
      yield* h.prepare(nativeSnapshot(2));
      expect((yield* h.prepare(nativeSnapshot(1))).status).toBe("stale");
      expect((yield* h.show("one", "reminder", 1)).status).toBe("stale");
      expect((yield* h.show("forged", "reminder", 2)).status).toBe("refused");
      expect(
        (yield* h.manager.request(
          NativeNotificationRequest.cases.Show.make({
            ref: {
              ...nativeRef("one", "reminder", 2),
              key: { ...nativeEvent.key, accountId: "other-account" },
            },
            version: 1,
          })
        )).status
      ).toBe("refused");
      expect(h.notifications).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "reply is unsupported without text retention; malformed action indices cannot select a fallback",
  () =>
    Effect.gen(function* unsupportedReply() {
      const h = yield* nativeHarness();
      yield* h.prepare();
      yield* h.show();

      for (const index of [-1, 0.5, 99, Number.NaN]) {
        yield* h.drive(0, { index, kind: "action" });
      }

      yield* h.drive(0, { kind: "reply" });
      expect(h.notices.map((notice) => notice._tag)).toEqual(["Reply"]);
      expect(h.notices).toMatchObject([{ supported: false }]);
      expect(h.opens).toEqual([]);
      expect(h.joins).toEqual([]);
      yield* h.drive(0, { kind: "click" });
      expect(h.focus).toEqual(["focus"]);
    }).pipe(Effect.scoped)
);

it.prop(
  "missing conferencing email or self participation omits whole unsupported contextual actions",
  [Schema.Boolean, Schema.Boolean, Schema.Boolean],
  ([conference, email, rsvp]) => {
    const event = {
      ...nativeEvent,
      conferenceUrl: conference ? nativeEvent.conferenceUrl : null,
      participantEmails: email ? nativeEvent.participantEmails : [],
      rsvp,
    };

    expect(
      nativeNotificationActions(event, "reminder").map(
        (action) => action.action
      )
    ).toEqual([
      ...(conference ? ["join"] : []),
      ...(email ? ["email"] : []),
      "show",
    ]);
    expect(
      nativeNotificationActions(event, "invite").map((action) => action.action)
    ).toEqual([
      ...(rsvp ? ["accepted", "declined", "tentative"] : []),
      ...(email ? ["email"] : []),
      "show",
    ]);
  }
);

const admissionMeeting: AgendaEventValue = {
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

const admissionInput = (
  events: readonly AgendaEventValue[] = [admissionMeeting]
): PromptInput => ({
  now: 0,
  preferences: defaultDesktopPreferences(),
  snapshot: { ...nativeSnapshot(), events },
});

it.effect(
  "processed prompt admission waits for the real actor rather than its pre-send snapshot",
  () =>
    Effect.gen(function* processedAdmission() {
      const held = yield* Deferred.make<boolean>();
      const entered = yield* Deferred.make<boolean>();
      const presented = yield* Ref.make(0);

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: () =>
            Ref.update(presented, (n) => n + 1).pipe(
              Effect.andThen(Deferred.succeed(entered, true)),
              Effect.andThen(Deferred.await(held)),
              Effect.asVoid
            ),
        },
        admissionInput([])
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );
      expect(actor.getSnapshot().context.pending).toEqual([]);

      const claims = yield* preparePromptAdmission(
        actor,
        admissionInput(),
        "first"
      );

      expect(claims).toEqual([
        { key: nativeEvent.key, start: nativeEvent.start },
      ]);
      yield* waitFor(actor, (snapshot) => snapshot.matches("presenting")).pipe(
        Effect.orDie
      );
      yield* Deferred.await(entered);
      expect(yield* Ref.get(presented)).toBe(1);
    }).pipe(Effect.scoped)
);

it.effect(
  "a real old acknowledgement at the same authority cannot satisfy a fresh admission attempt",
  () =>
    Effect.gen(function* oldAcknowledgement() {
      const held = yield* Deferred.make<boolean>();

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: () => Deferred.await(held).pipe(Effect.asVoid),
        },
        admissionInput([])
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );
      actor.send({
        ...admissionInput(),
        attempt: "old",
        permit: { active: true },
        type: "AdmissionInput",
      });

      const claims = yield* preparePromptAdmission(
        actor,
        admissionInput([]),
        "fresh"
      );

      expect(claims).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "unchanged presenting and normal Inputs acknowledge their reconciled membership without another reveal or play",
  () =>
    Effect.gen(function* unchangedAcknowledgements() {
      const held = yield* Deferred.make<boolean>();
      const reveals = yield* Ref.make(0);
      const plays = yield* Ref.make(0);

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: (_events, presentation) =>
            Effect.gen(function* present() {
              if (presentation.reveal) {
                yield* Ref.update(reveals, (n) => n + 1);

                if (presentation.sound !== "none") {
                  yield* Ref.update(plays, (n) => n + 1);
                }
              }

              yield* Deferred.await(held);
            }),
        },
        admissionInput([])
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );
      yield* preparePromptAdmission(actor, admissionInput(), "admitted");
      yield* waitFor(actor, (snapshot) => snapshot.matches("presenting")).pipe(
        Effect.orDie
      );
      const notices: string[] = [];
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          actor.on("InputProcessed", (notice) => {
            notices.push(notice.attempt ?? "legacy");
          })
        ),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );
      yield* send(actor, {
        ...admissionInput(),
        attempt: "unchanged-presenting",
        permit: { active: true },
        type: "AdmissionInput",
      });
      yield* send(actor, { ...admissionInput(), type: "Input" });
      yield* send(actor, { now: 1, type: "Tick" });
      yield* waitFor(actor, (snapshot) => snapshot.context.now === 1).pipe(
        Effect.orDie
      );
      expect(notices).toEqual(["unchanged-presenting", "legacy"]);
      expect(yield* Ref.get(reveals)).toBe(1);
      expect(yield* Ref.get(plays)).toBe(1);
      yield* Deferred.succeed(held, true);
      yield* waitFor(actor, (snapshot) => snapshot.matches("visible")).pipe(
        Effect.orDie
      );
      yield* send(actor, {
        ...admissionInput(),
        attempt: "unchanged-visible",
        permit: { active: true },
        type: "AdmissionInput",
      });
      yield* send(actor, { now: 2, type: "Tick" });
      yield* waitFor(actor, (snapshot) => snapshot.context.now === 2).pipe(
        Effect.orDie
      );
      expect(notices).toEqual([
        "unchanged-presenting",
        "legacy",
        "unchanged-visible",
      ]);
      expect(yield* Ref.get(reveals)).toBe(1);
      expect(yield* Ref.get(plays)).toBe(1);
    }).pipe(Effect.scoped)
);

it.effect(
  "unobserved prompt Inputs retain no acknowledgement state or backlog across a long unchanged history",
  () =>
    Effect.gen(function* unobservedAcknowledgements() {
      const actor = yield* startPrompt(
        { close: Effect.void, present: () => Effect.void },
        admissionInput([])
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );
      const keys = Object.keys(actor.getSnapshot().context).toSorted();

      for (let index = 0; index < 160; index += 1) {
        yield* send(actor, {
          ...admissionInput([]),
          attempt: `unobserved-${index}`,
          permit: { active: true },
          type: "AdmissionInput",
        });
      }

      yield* send(actor, { now: 3, type: "Tick" });
      yield* waitFor(actor, (snapshot) => snapshot.context.now === 3).pipe(
        Effect.orDie
      );
      const notices: string[] = [];

      const subscription = actor.on("InputProcessed", (notice) => {
        notices.push(notice.attempt ?? "legacy");
      });

      yield* send(actor, {
        ...admissionInput([]),
        attempt: "only-current",
        permit: { active: true },
        type: "AdmissionInput",
      });
      yield* send(actor, { now: 4, type: "Tick" });
      yield* waitFor(actor, (snapshot) => snapshot.context.now === 4).pipe(
        Effect.orDie
      );
      subscription.unsubscribe();
      expect(notices).toEqual(["only-current"]);
      expect(Object.keys(actor.getSnapshot().context).toSorted()).toEqual(keys);
      expect(actor.getSnapshot().context.pending).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect(
  "a stopped real prompt actor refuses native Prepare rather than returning empty membership",
  () =>
    Effect.gen(function* stoppedAdmission() {
      const actor = yield* startPrompt(
        { close: Effect.void, present: () => Effect.void },
        admissionInput([])
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );
      actor.stop();

      const h = yield* nativeHarness(Effect.void, Effect.void, () =>
        preparePromptAdmission(actor, admissionInput(), "stopped")
      );

      expect((yield* h.prepare()).status).toBe("refused");
      expect(h.notifications).toEqual([]);
      expect(h.focus).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect.each(["lease", "personId"] as const)(
  "a %s change while admission is queued refuses the old native pass",
  (field) =>
    Effect.gen(function* changedScope() {
      const actor = yield* startPrompt(
        { close: Effect.void, present: () => Effect.void },
        admissionInput([])
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );
      const original = admissionInput();
      const agenda = original.snapshot.notificationAgenda;

      if (agenda === undefined) {
        return yield* Effect.die("Missing fixture agenda");
      }

      const changed = {
        ...original,
        snapshot: {
          ...original.snapshot,
          notificationAgenda: { ...agenda, [field]: "other" },
        },
      };

      actor.send({ ...changed, type: "Input" });

      const outcome = yield* Effect.result(
        preparePromptAdmission(actor, original, "superseded")
      );

      expect(outcome._tag).toBe("Failure");

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "retired native histories retain only bounded current-delivery tombstones and reject pruned callbacks",
  () =>
    Effect.gen(function* boundedRegistry() {
      const h = yield* nativeHarness();

      for (let index = 1; index <= 96; index += 1) {
        const id = `delivery-${index}`;
        yield* h.prepare(nativeSnapshot(index, id));
        expect((yield* h.manager.registry).entries).toHaveLength(0);
        yield* h.show(id, "reminder", index);
        yield* h.drive(index - 1, {
          kind: index % 2 === 0 ? "failed" : "close",
        });
        const registry = yield* h.manager.registry;
        expect(registry.entries).toEqual([
          {
            generation: index,
            holdsEvent: false,
            holdsHandle: false,
            id,
            phase: "retired",
          },
        ]);
        expect(registry.replacements.length).toBeLessThanOrEqual(1);
      }

      yield* h.drive(0, { index: 0, kind: "action" });
      yield* h.drive(0, { kind: "close" });
      expect(h.joins).toEqual([]);
      expect(h.opens).toEqual([]);
      const empty = nativeSnapshot(97);
      yield* h.prepare({
        ...empty,
        notificationAgenda:
          empty.notificationAgenda === undefined
            ? undefined
            : { ...empty.notificationAgenda, deliveries: [] },
      });
      expect((yield* h.manager.registry).entries).toEqual([]);
      expect(
        h.notifications.every((notification) => notification.closed === 1)
      ).toBe(true);
    }).pipe(Effect.scoped)
);

it.effect(
  "same-ID content replacement creates one silent fresh generation and refuses all old callbacks and replay",
  () =>
    Effect.gen(function* sameIdReplacement() {
      const h = yield* nativeHarness();
      yield* h.prepare();
      const first = yield* h.show();

      const changed = {
        ...nativeEvent,
        body: "Current body",
        conferenceUrl: "https://meet.example.test/current",
        title: "Current title",
      };

      yield* h.prepare(nativeSnapshot(2, "one", "reminder", changed));
      expect(h.notifications).toHaveLength(2);
      expect(h.notifications[0]?.closed).toBe(1);
      expect(h.notifications[1]?.options).toMatchObject({
        body: changed.body,
        silent: true,
        title: changed.title,
      });
      const fresh = yield* h.show("one", "reminder", 2);
      expect(fresh.ref?.revision).toBe(2);
      expect(fresh.ref?.generation).toBeGreaterThan(first.ref?.generation ?? 0);
      yield* h.drive(0, { index: 0, kind: "action" });
      yield* h.drive(0, { kind: "close" });
      expect(h.joins).toEqual([]);
      expect(h.notifications[1]?.closed).toBe(0);
      yield* h.drive(1, { index: 0, kind: "action" });
      expect(h.joins).toEqual([changed]);
      yield* h.prepare(nativeSnapshot(2, "one", "reminder", changed));
      yield* h.show("one", "reminder", 2);
      expect(h.notifications).toHaveLength(2);
    }).pipe(Effect.scoped)
);

it.effect(
  "revoked AdmissionInputs drain without rolling back lease, person or revision or revealing an old meeting",
  () =>
    Effect.gen(function* revokedAdmissionDrain() {
      for (const presenting of [false, true]) {
        for (const mode of ["lease", "person", "revision", "interrupt"]) {
          const old = admissionInput([
            { ...admissionMeeting, title: "Old refused meeting" },
          ]);

          const base = admissionInput([]);
          const agenda = base.snapshot.notificationAgenda;

          if (agenda === undefined) {
            return yield* Effect.die("Missing test admission agenda");
          }

          const current: PromptInput = {
            ...base,
            snapshot: {
              ...base.snapshot,
              events: [
                {
                  ...admissionMeeting,
                  key: { ...admissionMeeting.key, eventId: "current" },
                  title: "Current meeting",
                },
              ],
              notificationAgenda: {
                ...agenda,
                lease: mode === "lease" ? "new-lease" : agenda.lease,
                personId: mode === "person" ? "new-person" : agenda.personId,
                revision:
                  mode === "revision" || mode === "interrupt"
                    ? 2
                    : agenda.revision,
              },
            },
          };

          const entered = yield* Deferred.make<boolean>();
          const held = yield* Deferred.make<boolean>();
          const titles = yield* Ref.make<readonly string[]>([]);

          const initial = presenting
            ? {
                ...base,
                snapshot: { ...base.snapshot, events: current.snapshot.events },
              }
            : base;

          const actor = yield* startPrompt(
            {
              close: Effect.void,
              present: (events) =>
                Ref.update(titles, (all) => [
                  ...all,
                  ...events.map((event) => event.title),
                ]).pipe(
                  Effect.andThen(Deferred.succeed(entered, true)),
                  Effect.andThen(Deferred.await(held)),
                  Effect.asVoid
                ),
            },
            initial
          );

          yield* presenting
            ? Deferred.await(entered).pipe(Effect.asVoid)
            : waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
                Effect.orDie,
                Effect.asVoid
              );

          if (mode === "interrupt") {
            yield* send(actor, { ...current, type: "Input" });
            yield* waitFor(
              actor,
              (snapshot) =>
                snapshot.context.snapshot.notificationAgenda?.revision === 2
            ).pipe(Effect.orDie);
            const originalSend = actor.send.bind(actor);
            let queued: Parameters<typeof actor.send>[0] | undefined;
            actor.send = (event) => {
              if (event.type === "AdmissionInput") {
                queued = event;
              } else {
                originalSend(event);
              }
            };

            const fiber = yield* preparePromptAdmission(
              actor,
              {
                ...old,
                snapshot: {
                  ...old.snapshot,
                  notificationAgenda: current.snapshot.notificationAgenda,
                },
              },
              "interrupted"
            ).pipe(Effect.forkChild);

            yield* Effect.yieldNow;
            yield* Fiber.interrupt(fiber);
            actor.send = originalSend;

            if (queued === undefined) {
              return yield* Effect.die("Admission was not registered");
            }

            originalSend(queued);
          } else {
            actor.send({ ...current, type: "Input" });

            const result = yield* preparePromptAdmission(
              actor,
              old,
              `revoked-${mode}`
            ).pipe(Effect.result);

            expect(result._tag).toBe("Failure");
          }

          actor.send({ now: 1, type: "Tick" });
          yield* waitFor(actor, (snapshot) => snapshot.context.now === 1).pipe(
            Effect.orDie
          );
          expect(
            actor.getSnapshot().context.snapshot.notificationAgenda
          ).toEqual(current.snapshot.notificationAgenda);
          expect(actor.getSnapshot().context.snapshot.events).toEqual(
            current.snapshot.events
          );
          expect(yield* Ref.get(titles)).not.toContain("Old refused meeting");
          actor.stop();
        }
      }

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "preinstalled newer authority refuses stale admission before send and at processing while equal batches still acknowledge",
  () =>
    Effect.gen(function* preinstalledAuthority() {
      for (const presenting of [false, true]) {
        for (const mode of ["revision", "lease", "person"]) {
          const base = admissionInput(
            presenting
              ? [{ ...admissionMeeting, title: "Current installed meeting" }]
              : []
          );

          const agenda = base.snapshot.notificationAgenda;

          if (agenda === undefined) {
            return yield* Effect.die("Missing test admission agenda");
          }

          const current: PromptInput = {
            ...base,
            snapshot: {
              ...base.snapshot,
              notificationAgenda: { ...agenda, revision: 2 },
            },
          };

          const old: PromptInput = {
            ...admissionInput([
              { ...admissionMeeting, title: "Old superseded meeting" },
            ]),
            snapshot: {
              ...base.snapshot,
              events: [
                { ...admissionMeeting, title: "Old superseded meeting" },
              ],
              notificationAgenda: {
                ...agenda,
                lease: mode === "lease" ? "old-lease" : agenda.lease,
                personId: mode === "person" ? "old-person" : agenda.personId,
                revision: mode === "revision" ? 1 : 2,
              },
            },
          };

          const held = yield* Deferred.make<boolean>();
          const entered = yield* Deferred.make<boolean>();
          const reveals = yield* Ref.make<readonly string[]>([]);

          const actor = yield* startPrompt(
            {
              close: Effect.void,
              present: (events) =>
                Ref.update(reveals, (all) => [
                  ...all,
                  ...events.map((event) => event.title),
                ]).pipe(
                  Effect.andThen(Deferred.succeed(entered, true)),
                  Effect.andThen(Deferred.await(held)),
                  Effect.asVoid
                ),
            },
            current
          );

          yield* presenting
            ? Deferred.await(entered).pipe(Effect.asVoid)
            : waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
                Effect.orDie,
                Effect.asVoid
              );

          const result = yield* preparePromptAdmission(
            actor,
            old,
            `already-${mode}`,
            {
              active: true,
              main: { ...agenda, revision: mode === "revision" ? 1 : 2 },
            }
          ).pipe(Effect.result);

          expect(result._tag).toBe("Failure");
          actor.send({ now: 1, type: "Tick" });
          yield* waitFor(actor, (snapshot) => snapshot.context.now === 1).pipe(
            Effect.orDie
          );
          expect(actor.getSnapshot().context.snapshot).toEqual(
            current.snapshot
          );
          expect(yield* Ref.get(reveals)).toEqual(
            presenting ? ["Current installed meeting"] : []
          );
          actor.send({
            ...old,
            attempt: `raw-stale-${mode}`,
            permit: {
              active: true,
              main: { ...agenda, revision: mode === "revision" ? 1 : 2 },
            },
            type: "AdmissionInput",
          });
          actor.send({ now: 2, type: "Tick" });
          yield* waitFor(actor, (snapshot) => snapshot.context.now === 2).pipe(
            Effect.orDie
          );
          expect(actor.getSnapshot().context.snapshot).toEqual(
            current.snapshot
          );

          const equal = yield* preparePromptAdmission(
            actor,
            { ...current, now: 2 },
            `equal-${mode}`
          );

          expect(equal).toEqual(
            presenting
              ? [{ key: admissionMeeting.key, start: admissionMeeting.start }]
              : []
          );
          expect(actor.getSnapshot().context.snapshot).toEqual(
            current.snapshot
          );
          expect(yield* Ref.get(reveals)).toEqual(
            presenting ? ["Current installed meeting"] : []
          );
          actor.stop();
        }
      }

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "main-current new lease admits ahead of the old prompt Agenda and produces exactly one native delivery across the next pass",
  () =>
    Effect.gen(function* currentMainLease() {
      for (const presenting of [false, true]) {
        const initial = admissionInput(presenting ? [admissionMeeting] : []);
        const agenda = initial.snapshot.notificationAgenda;

        if (agenda === undefined) {
          return yield* Effect.die("Missing test admission agenda");
        }

        const entered = yield* Deferred.make<boolean>();
        const held = yield* Deferred.make<boolean>();

        const actor = yield* startPrompt(
          {
            close: Effect.void,
            present: () =>
              Deferred.succeed(entered, true).pipe(
                Effect.andThen(Deferred.await(held)),
                Effect.asVoid
              ),
          },
          {
            ...initial,
            snapshot: {
              ...initial.snapshot,
              notificationAgenda: {
                ...agenda,
                lease: "old-lease",
                personId: "old-person",
                revision: 9,
              },
            },
          }
        );

        yield* presenting
          ? Deferred.await(entered).pipe(Effect.asVoid)
          : waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
              Effect.orDie,
              Effect.asVoid
            );

        const h = yield* nativeHarness(
          Effect.void,
          Effect.void,
          (snapshot, permit) =>
            preparePromptAdmission(
              actor,
              { ...admissionInput([]), snapshot },
              "main-current",
              permit
            )
        );

        const prepared = yield* h.prepare();
        expect(prepared.status).toBe("ready");
        expect(prepared.claims).toEqual([]);
        expect(
          actor.getSnapshot().context.snapshot.notificationAgenda?.lease
        ).toBe("lease");
        expect(
          actor.getSnapshot().context.snapshot.notificationAgenda?.personId
        ).toBe("person");
        yield* h.show();
        expect(h.notifications).toHaveLength(1);
        expect((yield* h.prepare(nativeSnapshot(2))).status).toBe("ready");
        yield* h.show("one", "reminder", 2);
        expect(h.notifications).toHaveLength(1);
        actor.stop();
      }

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each(["present", "deleted"] as const)(
  "a newer main publication with occurrence %s classifies real admission before any retry and never duplicates a handle",
  (mode) =>
    Effect.gen(function* supersededAdmissionRetry() {
      const actor = yield* startPrompt(
        { close: Effect.void, present: () => Effect.void },
        admissionInput([])
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );

      const mailbox =
        yield* Queue.unbounded<Parameters<typeof actor.send>[0]>();

      const sendOriginal = actor.send.bind(actor);
      actor.send = (event) => {
        if (
          event.type === "AdmissionInput" &&
          event.snapshot.notificationAgenda?.revision === 1
        ) {
          Queue.offerUnsafe(mailbox, event);
        } else {
          sendOriginal(event);
        }
      };

      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        (snapshot, permit) =>
          preparePromptAdmission(
            actor,
            { ...admissionInput([]), snapshot },
            "real-retry",
            permit
          )
      );

      const first = yield* h.prepare().pipe(Effect.forkChild);
      const queued = yield* Queue.take(mailbox);
      const next = nativeSnapshot(2);

      const publication =
        mode === "deleted"
          ? {
              ...next,
              notificationAgenda:
                next.notificationAgenda === undefined
                  ? undefined
                  : { ...next.notificationAgenda, deliveries: [], events: [] },
            }
          : next;

      yield* h.manager.install(publication);
      const outcome = yield* Fiber.join(first);
      expect(outcome.status).toBe(
        mode === "deleted" ? "refused" : "superseded"
      );

      if (mode === "deleted") {
        expect(h.notifications).toHaveLength(0);
        expect((yield* h.show("one", "reminder", 2)).status).toBe("refused");
        actor.stop();

        return yield* Effect.void;
      }

      expect(h.notifications).toHaveLength(0);
      expect((yield* h.prepare(nativeSnapshot(2))).status).toBe("ready");
      yield* h.show("one", "reminder", 2);
      expect(h.notifications).toHaveLength(1);
      sendOriginal(queued);
      sendOriginal({ now: 1, type: "Tick" });
      yield* waitFor(actor, (snapshot) => snapshot.context.now === 1).pipe(
        Effect.orDie
      );
      expect(
        actor.getSnapshot().context.snapshot.notificationAgenda?.revision
      ).toBe(2);
      yield* h.prepare(nativeSnapshot(3));
      yield* h.show("one", "reminder", 3);
      expect(h.notifications).toHaveLength(1);
      actor.stop();

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

const tracked = (
  subscription: { unsubscribe: () => void },
  release: () => void
) => {
  let active = true;

  return {
    unsubscribe: () => {
      if (active) {
        active = false;
        subscription.unsubscribe();
        release();
      }
    },
  };
};

const countAdmissionSubscriptions = (
  actor: Parameters<typeof preparePromptAdmission>[0]
) => {
  let handlers = 0;
  let observers = 0;
  const on = actor.on.bind(actor);
  const subscribe = actor.subscribe.bind(actor);

  actor.on = (type, handler) => {
    handlers += 1;

    return tracked(on(type, handler), () => {
      handlers -= 1;
    });
  };

  actor.subscribe = (
    next?:
      | Observer<ReturnType<typeof actor.getSnapshot>>
      | ((snapshot: ReturnType<typeof actor.getSnapshot>) => void),
    error?: (cause: unknown) => void,
    complete?: () => void
  ) => {
    observers += 1;

    const subscription =
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Forward the pinned actor's callback-or-observer overload without narrowing domain data.
      typeof next === "function" || next === undefined
        ? subscribe(next, error, complete)
        : subscribe(next);

    return tracked(subscription, () => {
      observers -= 1;
    });
  };

  return () => ({ handlers, observers });
};

it.effect(
  "every admission settlement releases real actor listeners across success, supersession, stopped and interruption histories",
  () =>
    Effect.gen(function* subscriptionHistory() {
      for (let index = 0; index < 96; index += 1) {
        const actor = yield* startPrompt(
          { close: Effect.void, present: () => Effect.void },
          admissionInput([])
        );

        yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
          Effect.orDie
        );
        const counts = countAdmissionSubscriptions(actor);
        const mode = index % 4;

        if (mode === 0) {
          yield* preparePromptAdmission(
            actor,
            admissionInput(),
            `success-${index}`
          );
        } else if (mode === 1) {
          const foreign = admissionInput([]);
          const agenda = foreign.snapshot.notificationAgenda;

          if (agenda === undefined) {
            return yield* Effect.die("Missing test admission agenda");
          }

          actor.send({
            ...foreign,
            snapshot: {
              ...foreign.snapshot,
              notificationAgenda: { ...agenda, lease: "superseded" },
            },
            type: "Input",
          });

          const result = yield* preparePromptAdmission(
            actor,
            admissionInput(),
            `superseded-${index}`
          ).pipe(Effect.result);

          expect(result._tag).toBe("Failure");
        } else if (mode === 2) {
          actor.stop();

          const result = yield* preparePromptAdmission(
            actor,
            admissionInput(),
            `stopped-${index}`
          ).pipe(Effect.result);

          expect(result._tag).toBe("Failure");
        } else {
          const originalSend = actor.send.bind(actor);
          actor.send = (event) => {
            if (event.type !== "AdmissionInput") {
              originalSend(event);
            }
          };

          const fiber = yield* preparePromptAdmission(
            actor,
            admissionInput(),
            `interrupt-${index}`
          ).pipe(Effect.forkChild);

          yield* Effect.yieldNow;
          expect(counts()).toEqual({ handlers: 1, observers: 1 });
          yield* Fiber.interrupt(fiber);
          actor.send = originalSend;
        }

        expect(counts()).toEqual({ handlers: 0, observers: 0 });
        actor.stop();
      }

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each([
  "publication",
  "person",
  "lease",
  "reset",
  "dispose",
  "cleared",
  "close",
  "replace",
] as const)(
  "a lost real admission acknowledgement leaves other native work and P49 reveal/play live until %s settles it",
  (mode) =>
    Effect.gen(function* lostAcknowledgementLiveness() {
      const reveals = yield* Ref.make(0);
      const plays = yield* Ref.make(0);
      const initial = admissionInput([]);
      const initialAgenda = initial.snapshot.notificationAgenda;

      if (initialAgenda === undefined) {
        return yield* Effect.die("Missing initial admission agenda");
      }

      const actor = yield* startPrompt(
        {
          close: Effect.void,
          present: (_events, presentation) =>
            Effect.gen(function* p49Presentation() {
              if (presentation.reveal) {
                yield* Ref.update(reveals, (value) => value + 1);

                if (presentation.sound !== "none") {
                  yield* Ref.update(plays, (value) => value + 1);
                }
              }
            }),
        },
        {
          ...initial,
          snapshot: {
            ...initial.snapshot,
            notificationAgenda: { ...initialAgenda, revision: 0 },
          },
        }
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );
      const lost = yield* Queue.unbounded<boolean>();
      const on = actor.on.bind(actor);
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          on("InputProcessed", (notice) => {
            if (notice.attempt === "lost-ack") {
              Queue.offerUnsafe(lost, true);
            }
          })
        ),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          })
      );

      let drop = true;

      let release: () => void = () => {
        drop = false;
      };

      actor.on = (type, handler) =>
        on(type, (notice) => {
          if (drop && notice.attempt === "lost-ack") {
            release = () => {
              handler(notice);
            };
          } else {
            handler(notice);
          }
        });
      const counts = countAdmissionSubscriptions(actor);
      const owned = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(owned, Exit.void));
      const permits: PromptAdmissionPermitValue[] = [];

      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        (snapshot, permit) => {
          permits.push(permit);

          return preparePromptAdmission(
            actor,
            { ...admissionInput([]), snapshot },
            "lost-ack",
            permit
          );
        }
      ).pipe(Effect.provideService(Scope.Scope, owned));

      const base = nativeSnapshot();
      const agenda = base.notificationAgenda;

      if (agenda === undefined) {
        return yield* Effect.die("Missing lost-ack agenda");
      }

      const other = {
        ...nativeEvent,
        key: { ...nativeEvent.key, eventId: "other-event" },
        title: "Other native meeting",
      };

      const snapshot = {
        ...base,
        notificationAgenda: {
          ...agenda,
          deliveries: [
            ...agenda.deliveries,
            {
              id: "two",
              key: other.key,
              kind: "reminder" as const,
              start: other.start,
            },
          ],
          events: [nativeEvent, other],
        },
      };

      const waiting = yield* h
        .prepare(snapshot, "one")
        .pipe(Effect.forkChild({ startImmediately: true }));

      const emitted = yield* Effect.raceFirst(
        Queue.take(lost).pipe(Effect.as(true)),
        Fiber.await(waiting).pipe(Effect.as(false))
      );

      expect(emitted).toBe(true);
      expect(waiting.pollUnsafe()).toBeUndefined();
      expect(counts()).toEqual({ handlers: 1, observers: 1 });

      const otherShow = yield* h.manager
        .request(
          NativeNotificationRequest.cases.Show.make({
            ref: { ...nativeRef("two"), key: other.key },
            version: 1,
          })
        )
        .pipe(Effect.forkChild({ startImmediately: true }));

      const shown = yield* Fiber.join(otherShow);
      expect(shown.status).toBe("ready");

      if (shown.ref === undefined) {
        return yield* Effect.die("Missing other native reference");
      }

      const otherClose = yield* h.manager
        .request(
          NativeNotificationRequest.cases.Close.make({
            refs: [shown.ref],
            version: 1,
          })
        )
        .pipe(Effect.forkChild({ startImmediately: true }));

      yield* Fiber.join(otherClose);
      expect(h.notifications[0]?.closed).toBe(1);
      actor.send({ ...admissionInput(), type: "Input" });
      yield* waitFor(actor, (value) => value.matches("visible")).pipe(
        Effect.orDie
      );
      expect(yield* Ref.get(reveals)).toBe(1);
      expect(yield* Ref.get(plays)).toBe(1);
      expect(waiting.pollUnsafe()).toBeUndefined();
      drop = false;

      if (mode === "publication" || mode === "person") {
        const next = {
          ...snapshot,
          notificationAgenda: {
            ...snapshot.notificationAgenda,
            personId: mode === "person" ? "new-person" : "person",
            revision: 2,
          },
        };

        yield* h.manager.install(next);
        expect((yield* Fiber.join(waiting)).status).toBe(
          mode === "publication" ? "superseded" : "refused"
        );

        if (mode === "publication") {
          expect((yield* h.prepare(next, "one")).status).toBe("ready");
          yield* h.show("one", "reminder", 2);
          yield* h.show("one", "reminder", 2);
          expect(
            h.notifications.filter(
              (notification) => notification.options.title === nativeEvent.title
            )
          ).toHaveLength(1);
        }
      } else if (mode === "close") {
        const closed = yield* h.manager
          .request(
            NativeNotificationRequest.cases.Close.make({
              refs: [nativeRef()],
              version: 1,
            })
          )
          .pipe(Effect.forkChild({ startImmediately: true }));

        yield* Fiber.join(closed);
        expect((yield* Fiber.join(waiting)).status).toBe("refused");
        yield* h.show();
        expect(
          h.notifications.filter(
            (notification) => notification.options.title === nativeEvent.title
          )
        ).toHaveLength(0);
      } else if (mode === "replace") {
        yield* h.show();
        yield* h.manager.request(
          NativeNotificationRequest.cases.Replace.make({
            ref: nativeRef(),
            version: 1,
          })
        );
        yield* Effect.sync(() => {
          release();
        });
        expect((yield* Fiber.join(waiting)).status).toBe("refused");
        yield* h.show();
        expect(
          h.notifications.filter(
            (notification) => notification.options.title === nativeEvent.title
          )
        ).toHaveLength(1);
      } else if (mode === "cleared") {
        yield* h.manager.install({ events: [] });
        expect((yield* Fiber.join(waiting)).status).toBe("refused");
      } else if (mode === "dispose") {
        yield* Scope.close(owned, Exit.void);
        expect((yield* Fiber.join(waiting)).status).toBe("refused");
      } else {
        yield* h.manager.reset(mode === "lease" ? "new-lease" : "lease");
        expect((yield* Fiber.join(waiting)).status).toBe("refused");
      }

      expect(permits.every((permit) => !permit.active)).toBe(true);
      expect(counts()).toEqual({ handlers: 0, observers: 0 });
      actor.stop();

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each([
  "survives",
  "deleted",
  "closed",
  "replaced",
  "lease",
  "person",
  "untrusted",
  "ended",
  "invalidate-reinstall",
  "reset-reinstall",
  "delivery-removed",
  "delivery-key",
  "delivery-start",
  "legacy-delivery-removed",
] as const)(
  "a successful real acknowledgement followed by %s before finalization preserves retry versus final semantics",
  (mode) =>
    Effect.gen(function* postAcknowledgementPublication() {
      const initial = admissionInput([]);
      const initialAgenda = initial.snapshot.notificationAgenda;

      if (initialAgenda === undefined) {
        return yield* Effect.die("Missing post-ack initial agenda");
      }

      const actor = yield* startPrompt(
        { close: Effect.void, present: () => Effect.void },
        {
          ...initial,
          snapshot: {
            ...initial.snapshot,
            notificationAgenda: { ...initialAgenda, revision: 0 },
          },
        }
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );
      const acknowledged = yield* Queue.unbounded<boolean>();
      const finish = yield* Deferred.make<boolean>();
      const counts = countAdmissionSubscriptions(actor);

      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        (snapshot, permit) =>
          preparePromptAdmission(
            actor,
            { ...admissionInput([]), snapshot },
            "post-ack",
            permit
          ),
        Queue.offer(acknowledged, true).pipe(
          Effect.andThen(Deferred.await(finish)),
          Effect.asVoid
        )
      );

      const pending = yield* h
        .prepare(
          nativeSnapshot(),
          mode === "legacy-delivery-removed" ? undefined : "one"
        )
        .pipe(Effect.forkChild);

      const emitted = yield* Effect.raceFirst(
        Queue.take(acknowledged).pipe(Effect.as(true)),
        Fiber.await(pending).pipe(Effect.as(false))
      );

      expect(emitted).toBe(true);
      expect(counts()).toEqual({ handlers: 0, observers: 0 });
      const next = nativeSnapshot(2);
      const agenda = next.notificationAgenda;

      if (agenda === undefined) {
        return yield* Effect.die("Missing post-ack agenda");
      }

      yield* Match.value(mode).pipe(
        Match.when("invalidate-reinstall", () => h.manager.invalidate),
        Match.when("reset-reinstall", () => h.manager.reset("lease")),
        Match.orElse(() => Effect.void)
      );

      yield* mode === "lease"
        ? h.manager.reset("new-lease")
        : h.manager.install({
            ...next,
            notificationAgenda: {
              ...agenda,
              deliveries: Match.value(mode).pipe(
                Match.when("deleted", () => []),
                Match.when("delivery-removed", () => []),
                Match.when("legacy-delivery-removed", () => []),
                Match.when("delivery-key", () =>
                  agenda.deliveries.map((delivery) => ({
                    ...delivery,
                    key: {
                      ...delivery.key,
                      eventId: "different-delivery-event",
                    },
                  }))
                ),
                Match.when("delivery-start", () =>
                  agenda.deliveries.map((delivery) => ({
                    ...delivery,
                    start: delivery.start + 1,
                  }))
                ),
                Match.orElse(() => agenda.deliveries)
              ),
              events: Match.value(mode).pipe(
                Match.when("deleted", () => []),
                Match.when("ended", () => [{ ...nativeEvent, end: 0 }]),
                Match.orElse(() => agenda.events)
              ),
              personId: mode === "person" ? "new-person" : agenda.personId,
            },
          });

      if (mode === "closed") {
        yield* h.manager.request(
          NativeNotificationRequest.cases.Close.make({
            refs: [nativeRef("one", "reminder", 2)],
            version: 1,
          })
        );
      } else if (mode === "replaced") {
        yield* h.show("one", "reminder", 2);
        yield* h.manager.request(
          NativeNotificationRequest.cases.Replace.make({
            ref: nativeRef("one", "reminder", 2),
            version: 1,
          })
        );
      } else if (mode === "untrusted") {
        yield* Ref.set(h.trusted, false);
      }

      yield* Deferred.succeed(finish, true);
      const result = yield* Fiber.join(pending);
      expect(result.status).toBe(
        mode === "survives" || mode === "legacy-delivery-removed"
          ? "superseded"
          : "refused"
      );

      if (mode === "survives") {
        expect((yield* h.prepare(next, "one")).status).toBe("ready");
        yield* h.show("one", "reminder", 2);
        yield* h.show("one", "reminder", 2);
        expect(h.notifications).toHaveLength(1);
      }

      expect(counts()).toEqual({ handlers: 0, observers: 0 });
      actor.stop();

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "interruption synchronously after registration before the acknowledgement race revokes and removes the admission",
  () =>
    Effect.gen(function* registrationInterruption() {
      const registered = yield* Queue.unbounded<boolean>();
      let active = true;
      let writes = 0;

      const h = yield* nativeHarness(
        Effect.void,
        Effect.void,
        (_snapshot, permit) => {
          const { active: initialActive } = permit;
          active = initialActive;
          Object.defineProperty(permit, "active", {
            get: () => active,
            set: (value: boolean) => {
              active = value;
              writes += 1;
            },
          });
          const current = Fiber.getCurrent();
          expect(current).toBeDefined();
          current?.interruptUnsafe();
          Queue.offerUnsafe(registered, true);

          return Effect.never;
        }
      );

      const pending = yield* h.prepare().pipe(Effect.forkChild);
      yield* Queue.take(registered);
      yield* Fiber.interrupt(pending);
      expect(active).toBe(false);
      expect(writes).toBe(1);
      yield* h.manager.reset("new-lease");
      expect(writes).toBe(1);
      expect((yield* h.manager.registry).entries).toEqual([]);
    }).pipe(Effect.scoped)
);

it.effect.each([1, 4])(
  "main revision %s mismatching candidate 2 is final even when the prompt holds revision 3",
  (revision) =>
    Effect.gen(function* permitMismatchPrecedence() {
      const input = admissionInput([]);
      const agenda = input.snapshot.notificationAgenda;

      if (agenda === undefined) {
        return yield* Effect.die("Missing precedence agenda");
      }

      const actor = yield* startPrompt(
        { close: Effect.void, present: () => Effect.void },
        {
          ...input,
          snapshot: {
            ...input.snapshot,
            notificationAgenda: { ...agenda, revision: 3 },
          },
        }
      );

      yield* waitFor(actor, (snapshot) => snapshot.matches("idle")).pipe(
        Effect.orDie
      );

      const outcome = yield* preparePromptAdmission(
        actor,
        {
          ...input,
          snapshot: {
            ...input.snapshot,
            notificationAgenda: { ...agenda, revision: 2 },
          },
        },
        "mismatched-main",
        { active: true, main: { ...agenda, revision } }
      ).pipe(Effect.result);

      expect(outcome._tag).toBe("Failure");

      if (Result.isFailure(outcome)) {
        expect(outcome.failure._tag).toBe("DesktopError");
      }

      expect(
        actor.getSnapshot().context.snapshot.notificationAgenda?.revision
      ).toBe(3);
      actor.stop();

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);
