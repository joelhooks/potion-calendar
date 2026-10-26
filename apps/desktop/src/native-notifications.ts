import { watchActor } from "@calendar/capability/actor-watch";
import {
  ConferenceUrl,
  NativeNotificationNotice,
  navigation,
  sameDesktopEventKey as sameKey,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaSnapshotValue,
  DesktopPreferencesValue,
  NativeNotificationAction,
  NativeNotificationAgenda,
  NativeNotificationEventRef,
  NativeNotificationRef,
  NativeNotificationReply,
  NativeNotificationRequest,
} from "@calendar/core/desktop-bridge";
import { composeParticipantEmail } from "@calendar/core/participant-email";
import { createEffectActor, createEffectLogic, join } from "@xstate/effect";
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Layer,
  Match,
  Predicate,
  Ref,
  Result,
  Schema,
  Semaphore,
} from "effect";

import { DesktopError } from "./config.js";
import { notificationPhase } from "./native-notification-machine.js";
import type { NativeNotificationPhase } from "./native-notification-machine.js";
import { PromptAdmissionSuperseded } from "./prompt-model.js";
import type { PromptAdmissionPermitValue } from "./prompt-model.js";

type Event = typeof NativeNotificationEventRef.Type;

type Reference = typeof NativeNotificationRef.Type;

type Action = typeof NativeNotificationAction.Type;

type Reply = typeof NativeNotificationReply.Type;

export interface NativeNotificationSignal {
  readonly kind: "show" | "failed" | "click" | "action" | "close" | "reply";
  readonly index?: number;
}

export interface NativeNotificationOptions {
  readonly actions: readonly {
    readonly action: Action;
    readonly text: string;
  }[];
  readonly body: string;
  readonly hasReply: false;
  readonly id: string;
  readonly silent: boolean;
  readonly title: string;
}

export interface NativeNotificationHandle {
  readonly show: Effect.Effect<void, DesktopError>;
  readonly close: Effect.Effect<void>;
}

export interface NativeNotificationPort {
  readonly origin: string;
  readonly supported: boolean;
  readonly trusted: Effect.Effect<boolean>;
  readonly preferences: Effect.Effect<DesktopPreferencesValue>;
  readonly beforeAction: Effect.Effect<void>;
  readonly beforeAdmissionFinish?: Effect.Effect<void>;
  readonly prepare: (
    snapshot: AgendaSnapshotValue,
    permit: PromptAdmissionPermitValue
  ) => Effect.Effect<Reply["claims"], DesktopError | PromptAdmissionSuperseded>;
  readonly create: (
    options: NativeNotificationOptions,
    receive: (signal: NativeNotificationSignal) => void
  ) => Effect.Effect<NativeNotificationHandle, DesktopError>;
  readonly emit: (
    notice: typeof NativeNotificationNotice.Type
  ) => Effect.Effect<void>;
  readonly run: (task: Effect.Effect<void>) => void;
  readonly join: (
    event: Event,
    authorized: Effect.Effect<boolean>
  ) => Effect.Effect<void, DesktopError>;
  readonly open: (
    href: string,
    authorized: Effect.Effect<boolean>
  ) => Effect.Effect<void, DesktopError>;
  readonly focus: Effect.Effect<void>;
}

interface LiveEntry {
  readonly actions: NativeNotificationOptions["actions"];
  readonly event: Event;
  readonly handle: NativeNotificationHandle;
  readonly phase: NativeNotificationPhase;
  readonly replacement: boolean;
  readonly ref: Reference;
}

interface RetiredEntry {
  readonly phase: "retired" | "failed";
  readonly ref: Reference;
  readonly replacement: boolean;
}

type Entry = LiveEntry | RetiredEntry;

const liveEntry = (entry: Entry | undefined): entry is LiveEntry =>
  entry !== undefined && "handle" in entry;

interface State {
  readonly lease: string;
  readonly agenda: typeof NativeNotificationAgenda.Type | undefined;
  readonly entries: ReadonlyMap<string, Entry>;
  readonly generation: number;
  readonly replacements: ReadonlySet<string>;
  readonly revision: number;
}

const sameSlot = (left: Reference, right: Reference) =>
  left.lease === right.lease &&
  left.personId === right.personId &&
  left.kind === right.kind &&
  sameKey(left.key, right.key) &&
  left.start === right.start;

const nativeOccurrenceSurvives = (
  requested: typeof NativeNotificationAgenda.Type | undefined,
  current: typeof NativeNotificationAgenda.Type | undefined,
  now: number,
  id?: string
): boolean =>
  requested?.deliveries.some(
    (delivery) =>
      (id === undefined || delivery.id === id) &&
      (id === undefined ||
        current?.deliveries.some(
          (candidate) =>
            candidate.id === id &&
            sameKey(candidate.key, delivery.key) &&
            candidate.start === delivery.start
        ) === true) &&
      current?.events.some(
        (event) =>
          sameKey(event.key, delivery.key) &&
          event.start === delivery.start &&
          event.end > now
      ) === true
  ) === true;

const duplicatePresentation = (
  prior: Entry | undefined,
  requested: Reference,
  replacement: boolean,
  event: Event,
  retiredGeneration?: number
): prior is Entry =>
  prior !== undefined &&
  sameSlot(prior.ref, requested) &&
  (!replacement ||
    (liveEntry(prior)
      ? JSON.stringify(prior.event) === JSON.stringify(event)
      : prior.ref.generation !== retiredGeneration));

const reply = (status: Reply["status"], ref?: Reference): Reply =>
  ref === undefined
    ? { claims: [], status, version: 1 }
    : { claims: [], ref, status, version: 1 };

const notificationRequestCurrent = (
  state: State,
  requested: Reference
): boolean => {
  const { agenda } = state;

  return (
    agenda !== undefined &&
    agenda.lease === state.lease &&
    requested.lease === agenda.lease &&
    requested.personId === agenda.personId &&
    requested.revision === agenda.revision &&
    agenda.deliveries.some(
      (delivery) =>
        delivery.id === requested.id &&
        delivery.kind === requested.kind &&
        delivery.start === requested.start &&
        sameKey(delivery.key, requested.key)
    )
  );
};

const selectedNotificationAction = (
  entry: LiveEntry,
  signal: NativeNotificationSignal
): Action | undefined => {
  if (signal.kind === "click") {
    return "show";
  }

  if (
    signal.index === undefined ||
    !Number.isInteger(signal.index) ||
    signal.index < 0
  ) {
    return undefined;
  }

  return entry.actions[signal.index]?.action;
};

export const nativeNotificationActions = (
  event: Event,
  kind: Reference["kind"]
): NativeNotificationOptions["actions"] => [
  ...(kind === "invite" && event.rsvp
    ? [
        { action: "accepted" as const, text: "Yes" },
        { action: "declined" as const, text: "No" },
        { action: "tentative" as const, text: "Maybe" },
      ]
    : []),
  ...(kind === "reminder" && event.conferenceUrl !== null
    ? [{ action: "join" as const, text: "Join" }]
    : []),
  ...(composeParticipantEmail(event.title, event.participantEmails).kind ===
  "ready"
    ? [{ action: "email" as const, text: "Email participants" }]
    : []),
  { action: "show", text: "Show event" },
];

const notificationWork = Effect.fn("Desktop.nativeNotificationWork")(
  function* notificationWork<A, E>(work: Effect.Effect<A, E>) {
    const logic = createEffectLogic({ effect: work.pipe(Effect.result) });
    const actor = yield* createEffectActor(logic);
    yield* watchActor("desktopNativeNotification", actor);
    const outcome = yield* join(actor).pipe(Effect.orDie);

    if (Result.isFailure(outcome)) {
      return yield* Effect.fail(outcome.failure);
    }

    return outcome.success;
  },
  Effect.scoped
);

const buildNativeNotifications = Effect.fn("Desktop.makeNativeNotifications")(
  function* makeNativeNotifications(
    port: NativeNotificationPort,
    initialLease: string
  ) {
    const serial = yield* Semaphore.make(1);

    const state = yield* Ref.make<State>({
      agenda: undefined,
      entries: new Map(),
      generation: 0,
      lease: initialLease,
      replacements: new Set(),
      revision: -1,
    });

    const admissions = new Set<{
      readonly permit: PromptAdmissionPermitValue;
      readonly revocation: { final: boolean };
      readonly revoked: Deferred.Deferred<
        Reply["claims"],
        DesktopError | PromptAdmissionSuperseded
      >;
      readonly snapshot: AgendaSnapshotValue;
      readonly id: string | undefined;
    }>();

    const revokeAdmissions = Effect.sync(() => {
      for (const admission of admissions) {
        admission.revocation.final = true;
        admission.permit.active = false;
        Deferred.doneUnsafe(
          admission.revoked,
          Effect.fail(
            new DesktopError({
              message: "Native admission authority was revoked",
            })
          )
        );
      }
    });

    const closeAdmissions = (ref: Reference) =>
      Effect.sync(() => {
        for (const admission of admissions) {
          if (
            admission.permit.main?.lease === ref.lease &&
            admission.permit.main.personId === ref.personId &&
            (admission.id === undefined || admission.id === ref.id) &&
            admission.snapshot.notificationAgenda?.deliveries.some(
              (delivery) =>
                delivery.id === ref.id &&
                sameKey(delivery.key, ref.key) &&
                delivery.start === ref.start
            ) === true
          ) {
            admission.revocation.final = true;
            admission.permit.active = false;
            Deferred.doneUnsafe(
              admission.revoked,
              Effect.fail(
                new DesktopError({
                  message: "Native delivery was closed during admission",
                })
              )
            );
          }
        }
      });

    const supersedeAdmissions = Effect.fn("Desktop.supersedeNativeAdmissions")(
      function* supersedeAdmissions(snapshot: AgendaSnapshotValue) {
        const next = snapshot.notificationAgenda;

        if (next === undefined) {
          return yield* revokeAdmissions;
        }

        const current = yield* Ref.get(state);
        const now = yield* Clock.currentTimeMillis;

        for (const admission of admissions) {
          const { main } = admission.permit;

          if (
            main === undefined ||
            next.lease !== current.lease ||
            next.revision < main.revision ||
            (next.revision === main.revision && next.personId === main.personId)
          ) {
            continue;
          }

          admission.permit.active = false;

          const eligible =
            next.lease === main.lease &&
            next.personId === main.personId &&
            nativeOccurrenceSurvives(
              admission.snapshot.notificationAgenda,
              next,
              now,
              admission.id
            );

          if (!eligible) {
            admission.revocation.final = true;
          }

          Deferred.doneUnsafe(
            admission.revoked,
            Effect.fail(
              eligible
                ? new PromptAdmissionSuperseded({
                    message: "A newer publication superseded native admission",
                  })
                : new DesktopError({
                    message:
                      "The native occurrence or person is no longer eligible",
                  })
            )
          );
        }

        return yield* Effect.void;
      }
    );

    const retire = Effect.fn("Desktop.retireNativeNotification")(
      function* retire(id: string, generation: number, replacement: boolean) {
        const entry = yield* Ref.modify(state, (current) => {
          const found = current.entries.get(id);

          if (!liveEntry(found) || found.ref.generation !== generation) {
            return [undefined, current];
          }

          const entries = new Map<string, Entry>(current.entries).set(id, {
            phase: "retired",
            ref: found.ref,
            replacement,
          });

          const replacements = new Set(current.replacements);

          if (replacement) {
            for (const delivery of current.agenda?.deliveries ?? []) {
              if (
                delivery.id !== id &&
                delivery.kind === found.ref.kind &&
                delivery.start === found.ref.start &&
                sameKey(delivery.key, found.ref.key)
              ) {
                replacements.add(delivery.id);
              }
            }
          }

          return [found, { ...current, entries, replacements }];
        });

        if (entry !== undefined) {
          yield* entry.handle.close;
        }
      }
    );

    const fresh = Effect.fn("Desktop.currentNativeNotification")(
      function* fresh(id: string, generation: number) {
        const current = yield* Ref.get(state);
        const entry = current.entries.get(id);
        const preferences = yield* port.preferences;
        const now = yield* Clock.currentTimeMillis;

        const event = current.agenda?.events.find(
          (item) =>
            entry !== undefined &&
            sameKey(item.key, entry.ref.key) &&
            item.start === entry.ref.start
        );

        return (yield* port.trusted) &&
          preferences.menuBar &&
          liveEntry(entry) &&
          entry.ref.generation === generation &&
          current.agenda?.lease === current.lease &&
          current.agenda.personId === entry.ref.personId &&
          current.agenda.revision === entry.ref.revision &&
          event !== undefined &&
          event.end > now
          ? entry
          : undefined;
      }
    );

    const perform = Effect.fn("Desktop.performNotificationAction")(
      function* perform(
        entry: LiveEntry,
        action: Action,
        authorized: Effect.Effect<boolean>
      ) {
        const { event } = entry;

        if (action === "join") {
          if (
            event.conferenceUrl === null ||
            !Schema.is(ConferenceUrl)(event.conferenceUrl) ||
            navigation(event.conferenceUrl, port.origin) !== "browser"
          ) {
            return false;
          }

          yield* port.join(event, authorized).pipe(Effect.ignore);
        } else if (action === "email") {
          const email = composeParticipantEmail(
            event.title,
            event.participantEmails
          );

          if (
            email.kind !== "ready" ||
            navigation(email.href, port.origin) !== "browser"
          ) {
            return false;
          }

          yield* port.open(email.href, authorized).pipe(Effect.ignore);
        } else if (action === "show") {
          yield* port.focus;
        } else if (!event.rsvp || entry.ref.kind !== "invite") {
          return false;
        }

        return true;
      }
    );

    const receiveWork = Effect.fn("Desktop.nativeNotificationEvent")(
      function* receive(
        id: string,
        generation: number,
        signal: NativeNotificationSignal
      ) {
        const original = yield* fresh(id, generation);

        if (original === undefined) {
          return;
        }

        if (signal.kind === "reply") {
          yield* port.emit(
            NativeNotificationNotice.cases.Reply.make({
              ref: original.ref,
              supported: false,
            })
          );

          return;
        }

        if (signal.kind === "close" || signal.kind === "failed") {
          yield* port.emit(
            signal.kind === "close"
              ? NativeNotificationNotice.cases.Closed.make({
                  ref: original.ref,
                })
              : NativeNotificationNotice.cases.Failed.make({
                  ref: original.ref,
                })
          );

          if (signal.kind !== "close" || original.phase !== "acting") {
            yield* retire(id, generation, false);
          }

          return;
        }

        if (signal.kind === "show") {
          yield* Ref.update(state, (current) => {
            const entry = current.entries.get(id);

            return liveEntry(entry) && entry.ref.generation === generation
              ? {
                  ...current,
                  entries: new Map(current.entries).set(id, {
                    ...entry,
                    phase: notificationPhase(entry.phase, "SHOW"),
                  }),
                }
              : current;
          });
          yield* port.emit(
            NativeNotificationNotice.cases.Shown.make({ ref: original.ref })
          );

          return;
        }

        const action = selectedNotificationAction(original, signal);

        if (action === undefined) {
          return;
        }

        const claimed = yield* Ref.modify(state, (current) => {
          const entry = current.entries.get(id);

          if (
            entry?.ref.generation !== generation ||
            (entry.phase !== "active" && entry.phase !== "showing")
          ) {
            return [false, current];
          }

          return [
            true,
            {
              ...current,
              entries: new Map(current.entries).set(id, {
                ...entry,
                phase: notificationPhase(entry.phase, "ACT"),
              }),
            },
          ];
        });

        if (!claimed) {
          return;
        }

        yield* port.beforeAction;
        const entry = yield* fresh(id, generation);

        if (entry === undefined) {
          return;
        }

        if (
          !(yield* perform(
            entry,
            action,
            fresh(id, generation).pipe(
              Effect.map((value) => value !== undefined)
            )
          ))
        ) {
          return;
        }

        const completed = yield* fresh(id, generation);

        if (completed === undefined) {
          return;
        }

        yield* port.emit(
          signal.kind === "click"
            ? NativeNotificationNotice.cases.Clicked.make({
                ref: completed.ref,
              })
            : NativeNotificationNotice.cases.ActionSelected.make({
                action,
                ref: completed.ref,
              })
        );
        yield* retire(id, generation, false);
      }
    );

    const receive = (
      id: string,
      generation: number,
      signal: NativeNotificationSignal
    ) => notificationWork(receiveWork(id, generation, signal));

    const show = Effect.fn("Desktop.showNativeNotification")(function* show(
      requested: Reference,
      replacement: boolean,
      retiredGeneration?: number
    ): Effect.fn.Return<Reply> {
      const current = yield* Ref.get(state);
      const { agenda } = current;
      const preferences = yield* port.preferences;

      const event = agenda?.events.find(
        (item) =>
          sameKey(item.key, requested.key) && item.start === requested.start
      );

      if (
        !port.supported ||
        !(yield* port.trusted) ||
        !preferences.menuBar ||
        event === undefined ||
        event.end <= (yield* Clock.currentTimeMillis)
      ) {
        return reply("refused");
      }

      if (
        agenda !== undefined &&
        requested.lease === current.lease &&
        requested.personId === agenda.personId &&
        requested.revision < agenda.revision
      ) {
        return reply("stale");
      }

      if (!notificationRequestCurrent(current, requested)) {
        return reply("refused");
      }

      const prior = current.entries.get(requested.id);

      if (
        duplicatePresentation(
          prior,
          requested,
          replacement,
          event,
          retiredGeneration
        )
      ) {
        return reply("ready", prior.ref);
      }

      const old = [...current.entries.values()].filter(
        (entry) =>
          (liveEntry(entry) || entry.replacement) &&
          sameSlot(entry.ref, requested)
      );

      for (const entry of old) {
        yield* retire(entry.ref.id, entry.ref.generation, false);
      }

      const generation = yield* Ref.modify(state, (value) => [
        value.generation + 1,
        { ...value, generation: value.generation + 1 },
      ]);

      const ref = { ...requested, generation };
      const actions = nativeNotificationActions(event, ref.kind);

      const created = yield* port
        .create(
          {
            actions,
            body: event.body,
            hasReply: false,
            id: JSON.stringify([ref.lease, ref.personId, ref.id, generation]),
            silent:
              replacement ||
              old.length > 0 ||
              current.replacements.has(requested.id),
            title:
              ref.kind === "invite" ? `Invite: ${event.title}` : event.title,
          },
          (signal) => {
            port.run(receive(ref.id, generation, signal));
          }
        )
        .pipe(Effect.result);

      if (Result.isFailure(created)) {
        return reply("failed");
      }

      const handle = created.success;

      yield* Ref.update(state, (value) => ({
        ...value,
        entries: new Map<string, Entry>(value.entries).set(ref.id, {
          actions,
          event,
          handle,
          phase: "showing",
          ref,
          replacement: false,
        }),
        replacements: new Set(
          [...value.replacements].filter((id) => id !== ref.id)
        ),
      }));
      yield* handle.show.pipe(
        Effect.catch(() => receive(ref.id, generation, { kind: "failed" }))
      );

      return reply("ready", ref);
    });

    const install = Effect.fn("Desktop.installNotificationAgenda")(
      function* install(snapshot: AgendaSnapshotValue) {
        const agenda = snapshot.notificationAgenda;
        const current = yield* Ref.get(state);

        if (agenda === undefined) {
          for (const entry of current.entries.values()) {
            yield* retire(entry.ref.id, entry.ref.generation, false);
          }

          yield* Ref.update(state, (value) => ({
            ...value,
            agenda: undefined,
            entries: new Map(),
            replacements: new Set<string>(),
          }));

          return false;
        }

        if (
          agenda.lease !== current.lease ||
          agenda.revision < current.revision
        ) {
          return false;
        }

        if (
          agenda.revision === current.revision &&
          JSON.stringify(agenda) !== JSON.stringify(current.agenda)
        ) {
          return false;
        }

        yield* Ref.update(state, (value) => ({
          ...value,
          agenda,
          revision: agenda.revision,
        }));

        for (const entry of current.entries.values()) {
          if (!liveEntry(entry)) {
            continue;
          }

          const event = agenda.events.find(
            (item) =>
              sameKey(item.key, entry.ref.key) && item.start === entry.ref.start
          );

          if (
            agenda.personId !== entry.ref.personId ||
            !agenda.deliveries.some(
              (delivery) =>
                delivery.id === entry.ref.id &&
                delivery.kind === entry.ref.kind &&
                delivery.start === entry.ref.start &&
                sameKey(delivery.key, entry.ref.key)
            ) ||
            event === undefined ||
            event.end <= (yield* Clock.currentTimeMillis) ||
            !(yield* port.preferences).menuBar
          ) {
            const replacement =
              agenda.personId === entry.ref.personId &&
              agenda.deliveries.some(
                (delivery) =>
                  delivery.id !== entry.ref.id &&
                  delivery.kind === entry.ref.kind &&
                  delivery.start === entry.ref.start &&
                  sameKey(delivery.key, entry.ref.key)
              );

            yield* retire(entry.ref.id, entry.ref.generation, replacement);
          } else if (JSON.stringify(event) === JSON.stringify(entry.event)) {
            yield* Ref.update(state, (value) => {
              const found = value.entries.get(entry.ref.id);

              return liveEntry(found) &&
                found.ref.generation === entry.ref.generation
                ? {
                    ...value,
                    entries: new Map<string, Entry>(value.entries).set(
                      entry.ref.id,
                      {
                        ...found,
                        ref: { ...found.ref, revision: agenda.revision },
                      }
                    ),
                  }
                : value;
            });
          } else {
            yield* retire(entry.ref.id, entry.ref.generation, false);
            yield* show(
              { ...entry.ref, revision: agenda.revision },
              true,
              entry.ref.generation
            );
          }
        }

        yield* Ref.update(state, (value) => ({
          ...value,
          entries: new Map(
            [...value.entries].filter(
              ([id, entry]) =>
                entry.ref.personId === agenda.personId &&
                agenda.deliveries.some((delivery) => delivery.id === id)
            )
          ),
          replacements: new Set(
            [...value.replacements].filter((id) =>
              agenda.deliveries.some((delivery) => delivery.id === id)
            )
          ),
        }));

        return true;
      }
    );

    const request = Effect.fn("Desktop.nativeNotificationRequest")(
      function* request(
        value: typeof NativeNotificationRequest.Type
      ): Effect.fn.Return<Reply, DesktopError> {
        if (!(yield* port.trusted)) {
          return reply("refused");
        }

        return yield* Match.value(value).pipe(
          Match.tagsExhaustive({
            Close: (message) =>
              Effect.gen(function* closeRequestedNotifications() {
                for (const ref of message.refs) {
                  const current = yield* Ref.get(state);
                  const entry = current.entries.get(ref.id);

                  if (
                    entry !== undefined &&
                    sameSlot(entry.ref, ref) &&
                    entry.ref.generation === ref.generation
                  ) {
                    yield* closeAdmissions(ref);
                    yield* retire(ref.id, ref.generation, false);
                  } else if (
                    entry === undefined &&
                    notificationRequestCurrent(current, ref)
                  ) {
                    yield* closeAdmissions(ref);
                    const generation = current.generation + 1;
                    yield* Ref.set(state, {
                      ...current,
                      entries: new Map(current.entries).set(ref.id, {
                        phase: "retired",
                        ref: { ...ref, generation },
                        replacement: false,
                      }),
                      generation,
                    });
                  }
                }

                return reply("ready");
              }),
            Prepare: (message) =>
              Effect.gen(function* prepareRequestedNotifications() {
                yield* supersedeAdmissions(message.snapshot);

                return yield* Effect.acquireUseRelease(
                  serial.withPermit(
                    Effect.gen(function* beginNativeAdmission() {
                      const current = yield* Ref.get(state);
                      const agenda = message.snapshot.notificationAgenda;

                      if (
                        !port.supported ||
                        !(yield* port.preferences).menuBar
                      ) {
                        return reply("refused");
                      }

                      if (
                        agenda !== undefined &&
                        agenda.lease === current.lease &&
                        agenda.personId === current.agenda?.personId &&
                        agenda.revision < current.revision
                      ) {
                        return reply(
                          nativeOccurrenceSurvives(
                            agenda,
                            current.agenda,
                            yield* Clock.currentTimeMillis,
                            message.id
                          )
                            ? "stale"
                            : "refused"
                        );
                      }

                      if (
                        !(yield* install(message.snapshot)) ||
                        agenda === undefined
                      ) {
                        return reply("refused");
                      }

                      const permit: PromptAdmissionPermitValue = {
                        active: true,
                        main: {
                          lease: agenda.lease,
                          personId: agenda.personId,
                          revision: agenda.revision,
                        },
                      };

                      const revoked = yield* Deferred.make<
                        Reply["claims"],
                        DesktopError | PromptAdmissionSuperseded
                      >();

                      if (
                        message.id !== undefined &&
                        !agenda.deliveries.some(
                          (delivery) => delivery.id === message.id
                        )
                      ) {
                        return reply("refused");
                      }

                      const installed = yield* Ref.get(state);

                      const generations = new Map(
                        agenda.deliveries
                          .filter(
                            (delivery) =>
                              message.id === undefined ||
                              delivery.id === message.id
                          )
                          .map((delivery) => [
                            delivery.id,
                            installed.entries.get(delivery.id)?.ref.generation,
                          ])
                      );

                      const waiting = {
                        agenda,
                        generations,
                        id: message.id,
                        permit,
                        revocation: { final: false },
                        revoked,
                        snapshot: message.snapshot,
                      };

                      admissions.add(waiting);

                      return waiting;
                    })
                  ),
                  (started) =>
                    Effect.gen(function* completeNativeAdmission() {
                      if ("status" in started) {
                        return started;
                      }

                      const { permit, revoked, agenda, generations } = started;

                      const admission = yield* Effect.result(
                        Effect.raceFirst(
                          port.prepare(message.snapshot, permit),
                          Deferred.await(revoked)
                        )
                      );

                      if (Result.isFailure(admission)) {
                        return reply(
                          Predicate.isTagged(
                            admission.failure,
                            "PromptAdmissionSuperseded"
                          )
                            ? "superseded"
                            : "refused"
                        );
                      }

                      const claims = admission.success;
                      yield* port.beforeAdmissionFinish ?? Effect.void;

                      return yield* serial.withPermit(
                        Effect.gen(function* finishNativeAdmission() {
                          const processed = yield* Ref.get(state);

                          if (
                            started.revocation.final ||
                            processed.lease !== agenda.lease ||
                            processed.agenda?.personId !== agenda.personId ||
                            [...generations].some(
                              ([id, generation]) =>
                                processed.entries.get(id)?.ref.generation !==
                                  generation ||
                                processed.entries.get(id)?.phase === "retired"
                            ) ||
                            !(yield* port.trusted)
                          ) {
                            return reply("refused");
                          }

                          if (processed.agenda.revision !== agenda.revision) {
                            return reply(
                              processed.agenda.revision > agenda.revision &&
                                nativeOccurrenceSurvives(
                                  agenda,
                                  processed.agenda,
                                  yield* Clock.currentTimeMillis,
                                  message.id
                                )
                                ? "superseded"
                                : "refused"
                            );
                          }

                          return {
                            authority: {
                              lease: agenda.lease,
                              personId: agenda.personId,
                              revision: agenda.revision,
                            },
                            claims,
                            status: "ready" as const,
                            version: 1 as const,
                          };
                        })
                      );
                    }),
                  (started) =>
                    Effect.sync(() => {
                      if (!("status" in started)) {
                        started.permit.active = false;
                        admissions.delete(started);
                      }
                    })
                );
              }),
            Replace: (message) => show(message.ref, true),
            Show: (message) => show(message.ref, false),
          })
        );
      }
    );

    const reset = Effect.fn("Desktop.resetNativeNotifications")(function* reset(
      lease: string
    ) {
      yield* revokeAdmissions;
      const current = yield* Ref.get(state);

      for (const entry of current.entries.values()) {
        yield* retire(entry.ref.id, entry.ref.generation, false);
      }

      yield* Ref.set(state, {
        agenda: undefined,
        entries: new Map(),
        generation: current.generation,
        lease,
        replacements: new Set<string>(),
        revision: -1,
      });
    });

    yield* Effect.addFinalizer(() => reset("disposed"));

    return {
      install: (snapshot: AgendaSnapshotValue) =>
        supersedeAdmissions(snapshot).pipe(
          Effect.andThen(notificationWork(serial.withPermit(install(snapshot))))
        ),
      invalidate: revokeAdmissions.pipe(
        Effect.andThen(
          Ref.update(state, (value) => ({
            ...value,
            agenda: undefined,
          }))
        )
      ),
      lease: Ref.get(state).pipe(Effect.map((value) => value.lease)),
      registry: Ref.get(state).pipe(
        Effect.map((value) => ({
          entries: [...value.entries].map(([id, entry]) => ({
            generation: entry.ref.generation,
            holdsEvent: "event" in entry,
            holdsHandle: "handle" in entry,
            id,
            phase: entry.phase,
          })),
          replacements: [...value.replacements],
        }))
      ),
      request: (value: typeof NativeNotificationRequest.Type) =>
        notificationWork(
          Match.value(value).pipe(
            Match.tag("Prepare", (message) => request(message)),
            Match.orElse((message) => serial.withPermit(request(message)))
          )
        ),
      reset: (lease: string) =>
        revokeAdmissions.pipe(Effect.andThen(serial.withPermit(reset(lease)))),
      revoke: (lease: string) =>
        revokeAdmissions.pipe(
          Effect.andThen(
            Ref.update(state, (value) => ({
              ...value,
              agenda: undefined,
              lease,
              revision: -1,
            }))
          )
        ),
    };
  }
);

export class NativeNotifications extends Context.Service<
  NativeNotifications,
  Effect.Success<ReturnType<typeof buildNativeNotifications>>
>()("@calendar/desktop/NativeNotifications") {
  static readonly layer = (port: NativeNotificationPort, lease: string) =>
    Layer.effect(NativeNotifications, buildNativeNotifications(port, lease));
}
