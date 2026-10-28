import {
  NativeNotificationNotice,
  NativeNotificationRequest,
  NativeNotificationRef,
  NativeReminderSnoozeChoice,
  desktopWire,
  nativeNotificationWire,
  sameDesktopEventKey,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaSnapshotValue,
  DesktopBridge,
  NativeNotificationReply,
} from "@calendar/core/desktop-bridge";
import {
  Clock,
  Deferred,
  Effect,
  Option,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import {
  desktopDependencies,
  desktopAgendaStream,
} from "../src/client/desktop/subscription.js";
import { DeliverReminderNotification } from "../src/client/reminders/commands.js";
import type { NotificationEvent } from "../src/client/reminders/model.js";
import {
  NotificationContent,
  ReminderSnooze,
  ReminderSnoozeStorage,
} from "../src/client/reminders/model.js";
import { routedNotifications } from "../src/client/reminders/native.js";
import { NotificationPort } from "../src/client/reminders/port.js";
import {
  PersistReminderSnooze,
  RestoreReminderSnoozes,
  SampleReminderSnoozeClock,
  RemoveReminderSnoozes,
} from "../src/client/reminders/snooze-commands.js";
import { saveReminderSnooze } from "../src/client/reminders/snooze-storage.js";
import { reminderSnapshot } from "../src/client/reminders/source.js";
import {
  nativeInvite,
  nativeReminderModel,
} from "./native-reminders-fixture.js";

type RootResult = ReturnType<typeof update>;

type Reference = typeof NativeNotificationRef.Type;

interface NativeSnoozeConnection {
  ref: Reference;
  listener:
    | ((notice: typeof NativeNotificationNotice.Type) => void)
    | undefined;
}

// @effect-diagnostics-next-line asyncFunction:off -- The fixture implements the foreign preload interface and rejects unrelated operations without another runtime.
const unexpectedNativeSnooze = async (): Promise<never> =>
  await Promise.reject(new Error("Unexpected native snooze bridge method"));

export const nativeSnoozeFixture = Effect.fn("nativeSnoozeFixture")(
  function* nativeSnoozeFixture(observed?: "near-start" | "near-end") {
    const fixture = nativeReminderModel(nativeInvite, "reminder");
    const [notification] = fixture.model.reminders.context.active;

    if (notification === undefined) {
      return yield* Effect.die("Missing native fixture reminder");
    }

    const now =
      observed === undefined
        ? fixture.model.calendar.now
        : notification.candidate[observed === "near-start" ? "start" : "end"] -
          1;

    const seed = {
      ...fixture.model,
      calendar: { ...fixture.model.calendar, now },
      reminders: {
        ...fixture.model.reminders,
        context: {
          ...fixture.model.reminders.context,
          coverage: Option.some(now),
          lastChecked: Option.some(now),
        },
      },
    };

    yield* TestClock.setTime(now);

    const restored = update(
      seed,
      yield* RestoreReminderSnoozes({ personId: fixture.ref.personId }).effect
    );

    const state = yield* Ref.make<AppModel>(restored.model);
    const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
    const ready = yield* Queue.unbounded<boolean>();

    const requests: (typeof NativeNotificationRequest.Type)[] = [];

    const connection: NativeSnoozeConnection = {
      listener: undefined,
      ref: fixture.ref,
    };

    const bridge: DesktopBridge = {
      getSettings: unexpectedNativeSnooze,
      joinMeeting: unexpectedNativeSnooze,
      // @effect-diagnostics-next-line asyncFunction:off -- This typed preload fake returns foreign Promises; production actors remain the caller.
      nativeNotifications: async (
        request
      ): Promise<typeof NativeNotificationReply.Type> => {
        requests.push(request);

        if (NativeNotificationRequest.guards.Prepare(request)) {
          const agenda = request.snapshot.notificationAgenda;

          return await Promise.resolve({
            authority: {
              lease: agenda?.lease ?? connection.ref.lease,
              personId: agenda?.personId ?? connection.ref.personId,
              revision: agenda?.revision ?? connection.ref.revision,
            },
            claims: [],
            status: "ready",
            version: 1,
          });
        }

        if (
          NativeNotificationRequest.guards.Show(request) ||
          NativeNotificationRequest.guards.Replace(request)
        ) {
          connection.ref = {
            ...request.ref,
            generation: connection.ref.generation + 1,
          };
          connection.listener?.(
            NativeNotificationNotice.cases.Ready.make({ ref: connection.ref })
          );

          return await Promise.resolve({
            claims: [],
            ref: connection.ref,
            status: "ready",
            version: 1,
          });
        }

        return await Promise.resolve({
          claims: [],
          status: "ready",
          version: 1,
        });
      },
      onAction: () => vi.fn<() => void>(),
      onNativeNotification: (listen) => {
        connection.listener = listen;
        Queue.offerUnsafe(ready, true);

        return () => {
          connection.listener = undefined;
        };
      },
      onSettings: () => vi.fn<() => void>(),
      publishAgenda: vi.fn<DesktopBridge["publishAgenda"]>(),
      savePreferences: unexpectedNativeSnooze,
      setStartup: unexpectedNativeSnooze,
    };

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

    const port = routedNotifications({
      close: () => Effect.die("Native snooze used browser close"),
      observe: () => Stream.empty,
      requestPermission: Effect.succeed("granted"),
      show: () => Effect.die("Native snooze used browser delivery"),
    });

    yield* port.observe(fixture.ref.personId).pipe(
      Stream.runForEach((event) => Queue.offer(events, event)),
      Effect.forkScoped
    );
    yield* Queue.take(ready);

    const apply = (message: AppMessage) =>
      Ref.modify(state, (model) => {
        const result = update(model, message);

        return [result, result.model];
      });

    const take = Effect.gen(function* takeNativeNotice() {
      const event = yield* Queue.take(events);
      const model = yield* Ref.get(state);

      return yield* apply(
        Message.ObservedNotification({ event, now: model.calendar.now })
      );
    });

    const model = yield* Ref.get(state);
    const [active] = model.reminders.context.active;

    if (active === undefined) {
      return yield* Effect.die("Missing native snooze reminder");
    }

    yield* port.show({
      ...active,
      native: { snapshot: desktopDependencies(model).snapshot },
    });
    yield* take;

    return {
      apply,
      choose: (
        choice: typeof NativeReminderSnoozeChoice.Type,
        ref: Reference = connection.ref
      ) =>
        Effect.sync(() => {
          connection.listener?.(
            NativeNotificationNotice.cases.SnoozeSelected.make({ choice, ref })
          );
        }),
      connection,
      events,
      port,
      replace: Effect.gen(function* replaceNativeGeneration() {
        connection.ref = {
          ...connection.ref,
          generation: connection.ref.generation + 1,
        };
        connection.listener?.(
          NativeNotificationNotice.cases.Ready.make({ ref: connection.ref })
        );

        return yield* take;
      }),
      requests,
      send: (notice: typeof NativeNotificationNotice.Type) =>
        Effect.sync(() => {
          connection.listener?.(notice);
        }),
      state,
      take,
    };
  }
);

export const sampleNativeSnooze = Effect.fn("sampleNativeSnooze")(
  function* sampleNativeSnooze(result: RootResult) {
    const command = result.commands?.find(
      (item) => item.name === "SampleReminderSnoozeClock"
    );

    if (command === undefined) {
      return yield* Effect.die("Missing native snooze clock command");
    }

    const args = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        choice: NativeReminderSnoozeChoice,
        id: Schema.String,
        identity: Schema.String,
        nativeRef: Schema.optional(NativeNotificationRef),
        personId: Schema.String,
      })
    )(command.args);

    return yield* SampleReminderSnoozeClock(args).effect;
  }
);

export const persistNativeSnooze = Effect.fn("persistNativeSnooze")(
  function* persistNativeSnooze(result: RootResult) {
    const command = result.commands?.find(
      (item) => item.name === "PersistReminderSnooze"
    );

    if (command === undefined) {
      return Option.none<ReturnType<typeof Message.ReminderSnoozeSaved>>();
    }

    const args = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        entry: ReminderSnooze,
        id: Schema.String,
        personId: Schema.String,
      })
    )(command.args);

    return Option.some(yield* PersistReminderSnooze(args).effect);
  }
);

interface NativeInvocation {
  readonly request: typeof NativeNotificationRequest.Type;
  readonly resolve: (reply: typeof NativeNotificationReply.Type) => void;
  readonly reject: (error: Error) => void;
}

interface InstalledWireAgenda {
  agenda: AgendaSnapshotValue["notificationAgenda"];
  generation: number;
  now: number;
}

const wireReply = (
  status: (typeof NativeNotificationReply.Type)["status"]
): typeof NativeNotificationReply.Type => ({ claims: [], status, version: 1 });

const sameWirePerson = (
  left: NonNullable<AgendaSnapshotValue["notificationAgenda"]>,
  right: NonNullable<AgendaSnapshotValue["notificationAgenda"]>
): boolean => left.lease === right.lease && left.personId === right.personId;

export const composedSnoozeRecipient = Effect.fn("composedSnoozeRecipient")(
  function* composedSnoozeRecipient() {
    const fixture = nativeReminderModel(nativeInvite, "reminder");
    const [original] = fixture.model.reminders.context.active;

    if (original === undefined) {
      return yield* Effect.die("Missing composed recipient event");
    }

    const now = original.candidate.start - 10 * 60_000;
    yield* TestClock.setTime(now);

    const sibling = {
      ...nativeInvite,
      end: { dateTime: "2026-10-26T12:00:00.000Z" },
      eventId: "other-occurrence",
      iCalUID: "other-occurrence@example.test",
      recurringEventId: undefined,
    };

    const loaded = update(
      { ...fixture.model, calendar: { ...fixture.model.calendar, now } },
      Message.ReceivedUpcoming({
        personId: fixture.ref.personId,
        request: fixture.model.upcoming.request,
        result: { events: [nativeInvite, sibling], versions: [] },
      })
    ).model;

    const other = reminderSnapshot(loaded)?.candidates.find(
      (candidate) => candidate.event.eventId === sibling.eventId
    );

    if (other === undefined) {
      return yield* Effect.die("Missing independent live recipient");
    }

    const state = yield* Ref.make<AppModel>({
      ...loaded,
      reminders: {
        ...loaded.reminders,
        context: {
          ...loaded.reminders.context,
          active: [
            {
              candidate: other,
              id: "other-live-reminder",
              nativeKind: "reminder",
              personId: fixture.ref.personId,
              title: other.title,
            },
          ],
          coverage: Option.some(now),
          lastChecked: Option.some(now),
          snoozeStorage: ReminderSnoozeStorage.cases.Ready.make({}),
          snoozes: [],
        },
      },
    });

    const tasks = yield* Queue.unbounded<Effect.Effect<void>>();
    const invocations = yield* Queue.unbounded<NativeInvocation>();
    const events = yield* Queue.unbounded<typeof NotificationEvent.Type>();
    const connected = yield* Deferred.make<boolean>();

    const callback: NativeSnoozeConnection = {
      listener: undefined,
      ref: fixture.ref,
    };

    const publications: AgendaSnapshotValue[] = [];

    const replies: {
      request: typeof NativeNotificationRequest.Type;
      reply: typeof NativeNotificationReply.Type;
    }[] = [];

    const shown: Reference[] = [];
    const executed: string[] = [];

    const installed: InstalledWireAgenda = {
      agenda: undefined,
      generation: 0,
      now,
    };

    const strictRequest = (
      request: typeof NativeNotificationRequest.Type
    ): typeof NativeNotificationReply.Type => {
      const current = installed.agenda;

      if (NativeNotificationRequest.guards.Prepare(request)) {
        const next = request.snapshot.notificationAgenda;

        if (
          next === undefined ||
          current === undefined ||
          !sameWirePerson(next, current)
        ) {
          return wireReply("refused");
        }

        if (next.revision < current.revision) {
          return wireReply("stale");
        }

        if (
          next.revision === current.revision &&
          JSON.stringify(next) !== JSON.stringify(current)
        ) {
          return wireReply("refused");
        }

        installed.agenda = next;

        const delivery = next.deliveries.find(
          (entry) => entry.id === request.id
        );

        const event =
          delivery === undefined
            ? undefined
            : next.events.find(
                (entry) =>
                  sameDesktopEventKey(entry.key, delivery.key) &&
                  entry.start === delivery.start
              );

        const claims =
          event !== undefined &&
          event.start <= installed.now &&
          event.end > installed.now
            ? [{ key: event.key, start: event.start }]
            : [];

        return {
          authority: {
            lease: next.lease,
            personId: next.personId,
            revision: next.revision,
          },
          claims,
          status: "ready",
          version: 1,
        };
      }

      if (NativeNotificationRequest.guards.Show(request)) {
        if (current === undefined || request.ref.revision < current.revision) {
          return wireReply("stale");
        }

        if (
          request.ref.revision !== current.revision ||
          request.ref.personId !== current.personId ||
          request.ref.lease !== current.lease
        ) {
          return wireReply("refused");
        }

        installed.generation += 1;
        const ref = { ...request.ref, generation: installed.generation };
        shown.push(ref);
        callback.listener?.(NativeNotificationNotice.cases.Ready.make({ ref }));
        callback.listener?.(NativeNotificationNotice.cases.Shown.make({ ref }));

        return { claims: [], ref, status: "ready", version: 1 };
      }

      return wireReply("ready");
    };

    yield* Stream.fromQueue(tasks).pipe(
      Stream.runForEach((task) => task),
      Effect.forkScoped
    );
    yield* Stream.fromQueue(invocations).pipe(
      Stream.runForEach((invocation) =>
        Effect.gen(function* composedIpcRequest() {
          const wire = yield* Schema.encodeEffect(
            nativeNotificationWire.request
          )(invocation.request).pipe(Effect.orDie);

          const request = yield* Schema.decodeEffect(
            nativeNotificationWire.request
          )(wire).pipe(Effect.orDie);

          installed.now = yield* Clock.currentTimeMillis;

          return strictRequest(request);
        }).pipe(
          Effect.match({
            onFailure: invocation.reject,
            onSuccess: (reply) => {
              replies.push({ reply, request: invocation.request });
              invocation.resolve(reply);
            },
          })
        )
      ),
      Effect.forkScoped
    );

    const bridge: DesktopBridge = {
      getSettings: unexpectedNativeSnooze,
      joinMeeting: unexpectedNativeSnooze,
      // oxlint-disable promise/avoid-new -- This test-only foreign preload Promise is settled by scoped Effect fibers rather than another runtime.
      // @effect-diagnostics-next-line asyncFunction:off -- The preload interface is a foreign Promise settled by the scoped IPC actor queue.
      nativeNotifications: async (request) =>
        // @effect-diagnostics-next-line newPromise:off -- A scoped Effect worker settles this foreign Promise without a second test runtime.
        await new Promise<typeof NativeNotificationReply.Type>(
          (resolve, reject) => {
            Queue.offerUnsafe(invocations, { reject, request, resolve });
          }
        ),
      // oxlint-enable promise/avoid-new -- The single foreign preload property ends here.
      onAction: () => vi.fn<() => void>(),
      onNativeNotification: (listen) => {
        callback.listener = listen;
        Deferred.doneUnsafe(connected, Effect.succeed(true));

        return () => {
          callback.listener = undefined;
        };
      },
      onSettings: () => vi.fn<() => void>(),
      publishAgenda: (snapshot) => {
        publications.push(snapshot);
        Queue.offerUnsafe(
          tasks,
          Effect.gen(function* composedPublication() {
            const wire = yield* Schema.encodeEffect(desktopWire.agenda)(
              snapshot
            ).pipe(Effect.orDie);

            const decoded = yield* Schema.decodeEffect(desktopWire.agenda)(
              wire
            ).pipe(Effect.orDie);

            const agenda = decoded.notificationAgenda;

            if (
              agenda !== undefined &&
              (installed.agenda === undefined ||
                agenda.revision >= installed.agenda.revision)
            ) {
              const prior = installed.agenda;
              installed.agenda = agenda;

              for (const old of shown) {
                const previous = prior?.deliveries.find(
                  (delivery) => delivery.id === old.id
                );

                const delivery = agenda.deliveries.find(
                  (entry) => entry.id === old.id
                );

                if (
                  delivery !== undefined &&
                  previous?.beforeStart === true &&
                  delivery.beforeStart === false
                ) {
                  installed.generation += 1;
                  callback.listener?.(
                    NativeNotificationNotice.cases.Ready.make({
                      ref: {
                        ...old,
                        generation: installed.generation,
                        revision: agenda.revision,
                      },
                    })
                  );
                }
              }
            }
          })
        );
      },
      savePreferences: unexpectedNativeSnooze,
      setStartup: unexpectedNativeSnooze,
    };

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

    const port = routedNotifications({
      close: () => Effect.die("Composed native used browser close"),
      observe: () => Stream.empty,
      requestPermission: Effect.succeed("granted"),
      show: () => Effect.die("Composed native used browser display"),
    });

    yield* port.observe(fixture.ref.personId).pipe(
      Stream.runForEach((event) => Queue.offer(events, event)),
      Effect.forkScoped
    );
    yield* Deferred.await(connected);
    const pending: NonNullable<RootResult["commands"]>[number][] = [];
    const published = { key: "" };

    const flush = Effect.gen(function* flushNativePublication() {
      const completed = yield* Deferred.make<boolean>();
      Queue.offerUnsafe(
        tasks,
        Deferred.succeed(completed, true).pipe(Effect.asVoid)
      );
      yield* Deferred.await(completed);
      yield* Effect.yieldNow;
    });

    const publish = Effect.fn("publishComposedSnooze")(function* publish(
      model: AppModel
    ) {
      const dependencies = desktopDependencies(model);
      const key = JSON.stringify(dependencies);

      if (key !== published.key) {
        published.key = key;
        yield* desktopAgendaStream(
          dependencies.active,
          dependencies.snapshot
        ).pipe(Stream.runDrain);
        yield* flush;
      }
    });

    const apply = Effect.fn("applyComposedSnooze")(function* apply(
      message: AppMessage
    ) {
      const result = yield* Ref.modify(state, (model) => {
        const next = update(model, message);

        return [next, next.model];
      });

      pending.push(...(result.commands ?? []));
      yield* publish(result.model);

      return result;
    });

    const pump = Effect.fn("pumpComposedSnooze")(function* pump(depth = 12) {
      for (let index = 0; index < depth; index += 1) {
        yield* flush;
        const event = yield* Queue.poll(events);

        if (Option.isSome(event)) {
          yield* apply(
            Message.ObservedNotification({
              event: event.value,
              now: yield* Clock.currentTimeMillis,
            })
          );
          continue;
        }

        const command = pending.shift();

        if (command === undefined) {
          return;
        }

        executed.push(command.name);

        if (command.name === "DeliverReminderNotification") {
          const args = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ notification: NotificationContent })
          )(command.args);

          yield* apply(
            yield* DeliverReminderNotification(args).effect.pipe(
              Effect.provideService(NotificationPort, port)
            )
          );
        } else if (command.name === "RemoveReminderSnoozes") {
          const args = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              entries: Schema.Array(ReminderSnooze),
              personId: Schema.String,
            })
          )(command.args);

          yield* apply(yield* RemoveReminderSnoozes(args).effect);
        }
      }
    });

    yield* publish(yield* Ref.get(state));
    yield* port
      .show({
        candidate: other,
        id: "other-live-reminder",
        native: {
          snapshot: desktopDependencies(yield* Ref.get(state)).snapshot,
        },
        nativeKind: "reminder",
        personId: fixture.ref.personId,
        title: other.title,
      })
      .pipe(
        Effect.catch((error) =>
          Effect.die(
            new Error(
              JSON.stringify({
                publication: publications.at(-1)?.notificationAgenda,
                reason: error.reason,
                replies,
              })
            )
          )
        )
      );
    yield* pump();

    return {
      apply,
      end: original.candidate.end,
      executed,
      pending,
      port,
      publications,
      pump,
      replies,
      schedule: (due: number) =>
        Effect.gen(function* scheduleNativeDeadline() {
          yield* saveReminderSnooze(fixture.ref.personId, {
            due,
            identity: original.candidate.identity,
          });
          yield* Ref.update(state, (model) => ({
            ...model,
            reminders: {
              ...model.reminders,
              context: {
                ...model.reminders.context,
                snoozeStorage: ReminderSnoozeStorage.cases.Loading.make({}),
              },
            },
          }));
          yield* apply(
            yield* RestoreReminderSnoozes({ personId: fixture.ref.personId })
              .effect
          );
          yield* pump();
        }),
      shown,
      start: original.candidate.start,
      state,
      tick: (at: number) =>
        Effect.gen(function* tickComposedRecipient() {
          yield* TestClock.setTime(at);
          yield* apply(Message.Ticked({ now: at }));
          yield* pump();
        }),
    };
  }
);
