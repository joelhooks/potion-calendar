import {
  NativeNotificationNotice,
  NativeNotificationRequest,
  sameDesktopEventKey as sameKey,
} from "@calendar/core/desktop-bridge";
import type {
  DesktopBridge,
  NativeNotificationRef,
  NativeNotificationReply,
} from "@calendar/core/desktop-bridge";
import { Effect, Option, Queue, Schema, Stream } from "effect";

import { browserDesktop } from "../desktop/commands.js";
import { browserNotifications } from "./browser.js";
import { NotificationEvent, NotificationFailure } from "./model.js";
import type { NotificationContentValue } from "./model.js";
import type { NotificationPortService } from "./port.js";

type Reference = typeof NativeNotificationRef.Type;

const retryableReply = (
  status: (typeof NativeNotificationReply.Type)["status"]
) => status === "stale" || status === "superseded";

const key = (personId: string, id: string) => JSON.stringify([personId, id]);

const currentBridge = () => Option.getOrUndefined(browserDesktop());

const sameReference = (left: Reference, right: Reference) =>
  left.id === right.id &&
  left.lease === right.lease &&
  left.personId === right.personId &&
  left.kind === right.kind &&
  left.start === right.start &&
  left.revision === right.revision &&
  sameKey(left.key, right.key);

type NativeObservationPhase = "active" | "snoozing" | "retired";

const observedNativePhase = (
  notice: typeof NativeNotificationNotice.Type,
  previous: NativeObservationPhase = "active"
): NativeObservationPhase => {
  if (NativeNotificationNotice.guards.SnoozeSelected(notice)) {
    return "snoozing";
  }

  if (
    NativeNotificationNotice.guards.Closed(notice) ||
    NativeNotificationNotice.guards.Failed(notice)
  ) {
    return "retired";
  }

  return NativeNotificationNotice.guards.Ready(notice) ||
    NativeNotificationNotice.guards.Shown(notice)
    ? "active"
    : previous;
};

export const routedNotifications = (
  browser: NotificationPortService = browserNotifications()
): NotificationPortService => {
  const refs = new Map<
    string,
    {
      readonly ref: Reference;
      readonly phase: "active" | "snoozing" | "retired";
    }
  >();

  const connected = new Map<string, symbol>();

  const closeNative = Effect.fn("NativeNotifications.close")(
    function* closeNative(bridge: DesktopBridge, values: readonly Reference[]) {
      const invoke = bridge.nativeNotifications;

      if (invoke === undefined || values.length === 0) {
        return;
      }

      yield* Effect.tryPromise({
        catch: () => new NotificationFailure({ reason: "delivery" }),
        // @effect-diagnostics-next-line asyncFunction:off -- The preload exposes a foreign Promise; this explicit callback isolates it inside Effect.tryPromise and preserves its receiver.
        try: async () =>
          await invoke.call(
            bridge,
            NativeNotificationRequest.cases.Close.make({
              refs: values,
              version: 1,
            })
          ),
      }).pipe(Effect.ignore);
    }
  );

  const prepare = Effect.fn("NativeNotifications.prepare")(function* prepare(
    content: NotificationContentValue
  ) {
    const snapshot = content.native?.snapshot;
    const bridge = currentBridge();
    const invoke = bridge?.nativeNotifications;
    const agenda = snapshot?.notificationAgenda;
    const connection = connected.get(content.personId);

    if (
      bridge === undefined ||
      invoke === undefined ||
      snapshot === undefined ||
      agenda === undefined ||
      content.nativeKind === undefined
    ) {
      return yield* new NotificationFailure({ reason: "unsupported" });
    }

    if (connection === undefined || agenda.personId !== content.personId) {
      return yield* new NotificationFailure({ reason: "inactive" });
    }

    const valid = () => connected.get(content.personId) === connection;

    const prepared = yield* Effect.tryPromise({
      catch: () => new NotificationFailure({ reason: "delivery" }),
      // @effect-diagnostics-next-line asyncFunction:off -- The preload exposes a foreign Promise; this explicit callback isolates it inside Effect.tryPromise and preserves its receiver.
      try: async () =>
        await invoke.call(
          bridge,
          NativeNotificationRequest.cases.Prepare.make({
            id: content.id,
            snapshot,
            version: 1,
          })
        ),
    });

    if (!valid()) {
      return yield* new NotificationFailure({ reason: "inactive" });
    }

    if (retryableReply(prepared.status)) {
      return yield* new NotificationFailure({
        lease: agenda.lease,
        personId: content.personId,
        reason: "stale",
        revision: agenda.revision,
      });
    }

    if (
      prepared.status !== "ready" ||
      prepared.authority?.lease !== agenda.lease ||
      prepared.authority.personId !== agenda.personId ||
      prepared.authority.revision !== agenda.revision
    ) {
      return yield* new NotificationFailure({ reason: "delivery" });
    }

    const eventKey = {
      accountId: content.candidate.event.accountId,
      calendarId: content.candidate.event.calendarId,
      eventId: content.candidate.event.eventId,
    };

    if (
      content.nativeKind === "reminder" &&
      prepared.claims.some(
        (claim) =>
          sameKey(claim.key, eventKey) &&
          claim.start === content.candidate.start
      )
    ) {
      return yield* new NotificationFailure({ reason: "inactive" });
    }

    const ref: Reference = {
      generation: agenda.revision,
      id: content.id,
      key: eventKey,
      kind: content.nativeKind,
      lease: agenda.lease,
      personId: content.personId,
      revision: agenda.revision,
      start: content.candidate.start,
    };

    return { bridge, invoke, ref, valid };
  });

  const show = Effect.fn("NativeNotifications.show")(function* show(
    content: NotificationContentValue
  ) {
    if (content.native === undefined) {
      return yield* browser.show(content);
    }

    const prepared = yield* prepare(content);

    const result = yield* Effect.tryPromise({
      catch: () => new NotificationFailure({ reason: "delivery" }),
      // @effect-diagnostics-next-line asyncFunction:off -- The preload exposes a foreign Promise; this explicit callback isolates it inside Effect.tryPromise and preserves its receiver.
      try: async () =>
        await prepared.invoke.call(
          prepared.bridge,
          NativeNotificationRequest.cases.Show.make({
            ref: prepared.ref,
            version: 1,
          })
        ),
    });

    if (!prepared.valid()) {
      if (result.ref !== undefined) {
        yield* closeNative(prepared.bridge, [result.ref]);
      }

      return yield* new NotificationFailure({ reason: "inactive" });
    }

    if (retryableReply(result.status)) {
      return yield* new NotificationFailure({
        lease: prepared.ref.lease,
        personId: prepared.ref.personId,
        reason: "stale",
        revision: prepared.ref.revision,
      });
    }

    if (
      result.status !== "ready" ||
      result.ref === undefined ||
      !sameReference(result.ref, prepared.ref)
    ) {
      return yield* new NotificationFailure({ reason: "delivery" });
    }

    const previous = refs.get(key(content.personId, content.id));

    if (
      previous === undefined ||
      previous.ref.generation <= result.ref.generation
    ) {
      refs.set(key(content.personId, content.id), {
        phase:
          previous?.ref.generation === result.ref.generation
            ? previous.phase
            : "active",
        ref: result.ref,
      });
    }

    return yield* Effect.void;
  });

  return {
    close: (personId, ids) =>
      Effect.gen(function* closeRoutedNotifications() {
        const native = ids.flatMap((id) => {
          const record = refs.get(key(personId, id));

          return record === undefined ? [] : [record.ref];
        });

        const bridge = currentBridge();

        if (bridge !== undefined) {
          yield* closeNative(bridge, native);

          for (const ref of native) {
            const record = refs.get(key(personId, ref.id));

            if (record?.ref.generation === ref.generation) {
              refs.set(key(personId, ref.id), {
                phase: "retired",
                ref: record.ref,
              });
            }
          }
        }

        const legacy = ids.filter((id) => !refs.has(key(personId, id)));

        if (legacy.length > 0) {
          yield* browser.close(personId, legacy);
        }
      }),
    observe: (personId) =>
      Stream.suspend(() => {
        const bridge = currentBridge();
        const listen = bridge?.onNativeNotification;

        return bridge?.nativeNotifications === undefined || listen === undefined
          ? browser.observe(personId)
          : Stream.callback<typeof NotificationEvent.Type>((queue) =>
              Effect.gen(function* nativeNotificationObserver() {
                const token = Symbol(personId);
                yield* Effect.acquireRelease(
                  Effect.sync(() => {
                    connected.set(personId, token);

                    return listen((value) => {
                      const decoded = Schema.decodeOption(
                        NativeNotificationNotice,
                        { onExcessProperty: "error" }
                      )(value);

                      if (
                        Option.isNone(decoded) ||
                        decoded.value.ref.personId !== personId ||
                        connected.get(personId) !== token
                      ) {
                        return;
                      }

                      const { ref } = decoded.value;
                      const old = refs.get(key(personId, ref.id));

                      if (
                        old !== undefined &&
                        old.ref.generation > ref.generation
                      ) {
                        return;
                      }

                      if (
                        NativeNotificationNotice.guards.SnoozeSelected(
                          decoded.value
                        ) &&
                        (old === undefined ||
                          old.phase !== "active" ||
                          old.ref.generation !== ref.generation ||
                          ref.revision < old.ref.revision ||
                          !sameReference(
                            { ...ref, revision: old.ref.revision },
                            old.ref
                          ))
                      ) {
                        return;
                      }

                      refs.set(key(personId, ref.id), {
                        phase: observedNativePhase(decoded.value, old?.phase),
                        ref,
                      });
                      Queue.offerUnsafe(
                        queue,
                        NotificationEvent.cases.Native.make({
                          notice: decoded.value,
                        })
                      );
                    });
                  }),
                  (stop) =>
                    Effect.gen(function* releaseNativeNotifications() {
                      stop();

                      if (connected.get(personId) !== token) {
                        return;
                      }

                      connected.delete(personId);
                      yield* closeNative(
                        bridge,
                        [...refs.values()].flatMap((record) =>
                          record.ref.personId === personId ? [record.ref] : []
                        )
                      );

                      for (const [id, record] of refs) {
                        if (record.ref.personId === personId) {
                          refs.delete(id);
                        }
                      }
                    })
                );

                return yield* Effect.never;
              })
            );
      }),
    requestPermission: Effect.suspend(() =>
      currentBridge()?.nativeNotifications === undefined
        ? browser.requestPermission
        : Effect.fail(new NotificationFailure({ reason: "unsupported" }))
    ),
    show,
  };
};
