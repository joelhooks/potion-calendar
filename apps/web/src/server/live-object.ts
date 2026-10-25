import {
  allowedEmail,
  authContext,
  createGoogleAuth,
} from "@calendar/auth/google";
import type { GoogleAuthConfig } from "@calendar/auth/google";
import { CalendarService, NotConnected, Provider } from "@calendar/calendar";
import type {
  CalendarChangedValue,
  CalendarFailureValue,
} from "@calendar/calendar";
import { accountDisconnectRepository } from "@calendar/database/account-disconnect";
import { googlePushRepository } from "@calendar/database/google-push";
import type {
  DurableObjectState,
  WebSocket as WorkerWebSocket,
  WebSocketPair as WorkerWebSocketPair,
} from "@cloudflare/workers-types";
import { Cause, Clock, Effect, Option, Result, Schema } from "effect";

import { LiveFrame } from "../client/live/protocol.js";
import type { LiveFrameValue } from "../client/live/protocol.js";
import type { CalendarEnvironment } from "./calendar-environment.js";
import { calendarAuthConfig } from "./calendar-origin.js";
import type { CalendarOriginPolicy } from "./calendar-origin.js";
import { calendarForPerson } from "./calendar-runtime.js";
import { d1CalendarStore } from "./calendar-store.js";
import { CalendarSynchronization } from "./calendar-synchronization.js";
import { deleteAccountForPerson } from "./delete-account-runtime.js";
import { maintainGoogleChannels } from "./google-channel-maintenance.js";
import { stopAccountGoogleChannels } from "./google-channel-stop.js";
import { liveAdmission } from "./live-admission.js";
import { LiveSyncPolicy, LiveCoordinator } from "./live-coordinator.js";
import type { LiveCoordinatorValue } from "./live-coordinator.js";
import { liveJobs } from "./live-jobs.js";
import { liveMaintenanceState } from "./live-maintenance-state.js";
import { LiveCommand, LiveReply } from "./live-protocol.js";
import type { LiveCommandValue } from "./live-protocol.js";
import { LiveWork, LiveOutput, liveWorkKey } from "./live-work.js";
import type { LiveOutputValue, LiveWorkValue } from "./live-work.js";

declare const WebSocketPair: typeof WorkerWebSocketPair;

const Attachment = Schema.Struct({ personId: Schema.NonEmptyString });

const unavailable = () =>
  new Provider({
    message: "Live calendar owner is unavailable",
    operation: "live",
    status: 0,
  });

export const calendarLiveClass = (policy: CalendarOriginPolicy) =>
  class CalendarLive {
    private readonly admission = liveAdmission();
    private readonly jobs;
    private readonly maintenance;
    private readonly ready: Promise<{
      readonly config: GoogleAuthConfig;
      readonly coordinator: LiveCoordinatorValue;
    }>;

    private readonly state: DurableObjectState;
    private readonly environment: CalendarEnvironment;

    constructor(state: DurableObjectState, environment: CalendarEnvironment) {
      this.state = state;
      this.environment = environment;
      this.jobs = liveJobs(state.storage, this.admission.accepts);
      this.maintenance = liveMaintenanceState(state.storage);
      this.ready = state.blockConcurrencyWhile(
        // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare invokes its initialization gate through a native Promise callback.
        async () =>
          await Effect.runPromise(
            Effect.gen({ self: this }, function* initializeLiveOwner() {
              const config = yield* calendarAuthConfig(environment, policy);

              const coordinator = yield* LiveCoordinator.pipe(
                Effect.provide(
                  LiveCoordinator.layer(
                    this.jobs,
                    (work) => this.execute(work),
                    this.admission
                  )
                )
              );

              return { config, coordinator };
            })
          )
      );
    }

    private ownerId(personId: string) {
      if (
        this.state.id.toString() !==
        this.environment.CALENDAR_LIVE.idFromName(personId).toString()
      ) {
        return Effect.fail(
          new Provider({
            message: "Unknown live owner",
            operation: "live",
            status: 404,
          })
        );
      }

      return Effect.void;
    }

    private personStatus(personId: string) {
      return Effect.gen({ self: this }, function* personStatus() {
        const { config } = yield* Effect.tryPromise({
          catch: unavailable,
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => this.ready,
        });

        const context = yield* authContext(
          createGoogleAuth(config, this.environment.DB)
        );

        const row = yield* Effect.tryPromise({
          catch: unavailable,
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () =>
            context.adapter.findOne({
              model: "user",
              where: [{ field: "id", value: personId }],
            }),
        });

        const person = yield* Schema.decodeUnknownEffect(
          Schema.NullOr(Schema.Struct({ email: Schema.String }))
        )(row).pipe(Effect.mapError(unavailable));

        if (person === null) {
          return "missing" as const;
        }

        return allowedEmail(person.email, config.allowedEmails)
          ? ("allowed" as const)
          : ("refused" as const);
      });
    }

    private owned(personId: string) {
      return Effect.gen({ self: this }, function* admitLiveOwner() {
        yield* this.ownerId(personId);

        const status = yield* this.personStatus(personId);

        if (status === "missing") {
          yield* this.forgetPerson().pipe(
            Effect.catchCause(() =>
              Effect.logWarning("Deleted account live cleanup remains pending")
            )
          );

          return yield* unavailable();
        }

        if (status !== "allowed") {
          return yield* unavailable();
        }

        if (!this.admission.accepts()) {
          return yield* new Provider({
            message: "Account deletion has paused live work",
            operation: "live",
            status: 409,
          });
        }

        return yield* this.jobs.bindPerson(personId);
      });
    }

    private forgetPerson() {
      const cleanup = Effect.gen({ self: this }, function* forgetPerson() {
        const { coordinator } = yield* Effect.tryPromise({
          catch: unavailable,
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => this.ready,
        });

        yield* Effect.sync(() => {
          this.admission.pause();
        });
        yield* coordinator.awaitAll();
        yield* Effect.sync(() => {
          for (const socket of this.state.getWebSockets()) {
            socket.close(1008, "Account deleted");
          }
        });
        yield* Effect.tryPromise({
          catch: unavailable,
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => this.state.storage.delete("calendar-inventory"),
        });

        while (true) {
          const entries = yield* Effect.tryPromise({
            catch: unavailable,
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () =>
              this.state.storage.list({
                limit: 100,
                prefix: "watch-cooldown:",
              }),
          });

          if (entries.size === 0) {
            break;
          }

          yield* Effect.tryPromise({
            catch: unavailable,
            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () => this.state.storage.delete([...entries.keys()]),
          });
        }

        yield* Effect.tryPromise({
          catch: unavailable,
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => this.state.storage.deleteAlarm(),
        });

        return yield* this.jobs.clear;
      });

      return cleanup.pipe(
        Effect.onError(() =>
          Effect.gen({ self: this }, function* retainCleanupAlarm() {
            const livePolicy = yield* LiveSyncPolicy;
            const now = yield* Clock.currentTimeMillis;
            yield* Effect.tryPromise({
              catch: unavailable,
              // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
              try: () =>
                this.state.storage.setAlarm(now + livePolicy.retryBaseMs),
            }).pipe(Effect.ignore);
          })
        )
      );
    }

    private deletePerson(personId: string) {
      return Effect.gen({ self: this }, function* deletePerson() {
        yield* this.ownerId(personId);

        const status = yield* this.personStatus(personId);

        if (status === "missing") {
          yield* this.forgetPerson().pipe(
            Effect.catchCause(() =>
              Effect.logWarning("Deleted account live cleanup remains pending")
            )
          );

          return null;
        }

        if (status !== "allowed") {
          return yield* unavailable();
        }

        const { config, coordinator } = yield* Effect.tryPromise({
          catch: unavailable,
          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => this.ready,
        });

        if (this.admission.accepts()) {
          yield* this.jobs.bindPerson(personId);
        }

        yield* calendarForPerson(
          createGoogleAuth(config, this.environment.DB),
          config,
          personId,
          {
            storeFor: (owner) => d1CalendarStore(this.environment.DB, owner),
            tokenMode: "cached-only",
          },
          [],
          deleteAccountForPerson(this.environment.DB, personId, {
            finalize: this.forgetPerson(),
            pause: coordinator.pause(),
            resume: coordinator.resume,
          })
        ).pipe(Effect.mapError(unavailable));

        return null;
      });
    }

    private broadcast(personId: string, frame: LiveFrameValue) {
      return Effect.gen({ self: this }, function* broadcastFrame() {
        const encoded = yield* Schema.encodeEffect(
          Schema.toCodecJson(LiveFrame)
        )(frame).pipe(Effect.orDie);

        const payload = JSON.stringify(encoded);

        for (const socket of this.state.getWebSockets()) {
          const attachment = Schema.decodeUnknownOption(Attachment)(
            socket.deserializeAttachment()
          );

          if (
            Option.isNone(attachment) ||
            attachment.value.personId !== personId
          ) {
            socket.close(1008, "Invalid observer scope");
            continue;
          }

          yield* Effect.try({
            catch: () => null,
            try: () => {
              socket.send(payload);
            },
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                socket.close(1011, "Observer unavailable");
              })
            )
          );
        }
      });
    }

    private execute(work: LiveWorkValue) {
      return Effect.gen(
        { self: this },
        function* executeLiveWork(): Effect.fn.Return<
          LiveOutputValue,
          CalendarFailureValue
        > {
          const { config } = yield* Effect.tryPromise({
            catch: (cause) =>
              new Cause.UnknownError(cause, "Native Promise adapter failed"),

            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () => this.ready,
          }).pipe(Effect.orDie);

          const { personId } = yield* this.jobs.owner;
          const auth = createGoogleAuth(config, this.environment.DB);
          const context = yield* authContext(auth);

          const row = yield* Effect.tryPromise({
            catch: unavailable,

            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () =>
              context.adapter.findOne({
                model: "user",
                where: [{ field: "id", value: personId }],
              }),
          });

          const person = yield* Schema.decodeUnknownEffect(
            Schema.NullOr(Schema.Struct({ email: Schema.String }))
          )(row).pipe(Effect.mapError(unavailable));

          if (
            person === null ||
            !allowedEmail(person.email, config.allowedEmails)
          ) {
            yield* Effect.sync(() => {
              for (const socket of this.state.getWebSockets()) {
                socket.close(1008, "Session unavailable");
              }
            });

            return yield* new NotConnected({
              accountId: LiveWork.guards.Calendar(work) ? work.accountId : "",
            });
          }

          const options = {
            changes: {
              publish: (change: CalendarChangedValue) =>
                this.broadcast(personId, change),
            },
            storeFor: (owner: string) =>
              d1CalendarStore(this.environment.DB, owner),
          };

          if (LiveWork.guards.Calendar(work)) {
            const result = yield* calendarForPerson(
              auth,
              config,
              personId,
              options,
              [work],
              CalendarSynchronization.use((sync) => sync.run(work))
            );

            return LiveOutput.cases.Calendar.make({ result });
          }

          return yield* calendarForPerson(
            auth,
            config,
            personId,
            options,
            [],
            Effect.gen({ self: this }, function* reconcileChannels() {
              const service = yield* CalendarService;
              const listing = yield* service.listCalendars();

              const maintenance = yield* maintainGoogleChannels(
                googlePushRepository(this.environment.DB),
                personId,
                listing,
                `${config.baseURL}/google/push`,
                this.maintenance,
                (accountId) =>
                  accountDisconnectRepository(this.environment.DB, personId)
                    .load(accountId)
                    .pipe(
                      Effect.map((receipt) => receipt !== null),
                      Effect.mapError(
                        () =>
                          new Provider({
                            message:
                              "Account disconnection journal is unavailable",
                            operation: "watch",
                            status: 0,
                          })
                      )
                    )
              ).pipe(Effect.result);

              yield* this.maintenance.inventory(
                listing,
                this.broadcast(personId, LiveFrame.members[1].make({}))
              );

              if (Result.isFailure(maintenance)) {
                return yield* maintenance.failure;
              }

              return LiveOutput.cases.Inventory.make({});
            })
          );
        }
      );
    }

    private synchronize(work: LiveWorkValue) {
      return Effect.gen({ self: this }, function* synchronizeFresh() {
        const { coordinator } = yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Native Promise adapter failed"),

          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => this.ready,
        }).pipe(Effect.orDie);

        const key = liveWorkKey(work);
        const now = yield* Clock.currentTimeMillis;

        yield* this.jobs.enqueue(work, now, 0);

        while (true) {
          const result = yield* coordinator.run(key);
          const pending = yield* this.jobs.get(key);

          if (
            pending === undefined ||
            (LiveWork.guards.Inventory(work) &&
              pending.dueAt > (yield* Clock.currentTimeMillis))
          ) {
            return result ?? null;
          }
        }
      });
    }

    private stopAccount(accountId: string) {
      return Effect.gen({ self: this }, function* stopOwnedAccount() {
        const { config, coordinator } = yield* Effect.tryPromise({
          catch: (cause) =>
            new Cause.UnknownError(cause, "Native Promise adapter failed"),

          // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
          try: () => this.ready,
        }).pipe(Effect.orDie);

        yield* coordinator
          .awaitExisting(liveWorkKey(LiveWork.cases.Inventory.make({})))
          .pipe(Effect.ignore);
        const { personId } = yield* this.jobs.owner;
        const auth = createGoogleAuth(config, this.environment.DB);
        yield* calendarForPerson(
          auth,
          config,
          personId,
          { storeFor: (owner) => d1CalendarStore(this.environment.DB, owner) },
          [],
          stopAccountGoogleChannels(
            googlePushRepository(this.environment.DB),
            personId,
            accountId
          )
        );

        return null;
      });
    }

    private command(command: LiveCommandValue) {
      return Effect.gen(
        { self: this },
        function* executeCommand(): Effect.fn.Return<
          LiveOutputValue | null,
          CalendarFailureValue
        > {
          if (!LiveCommand.guards.DeleteAccount(command)) {
            yield* this.owned(command.personId);
          }

          const now = yield* Clock.currentTimeMillis;

          return yield* LiveCommand.match(command, {
            DeleteAccount: ({ personId }) => this.deletePerson(personId),
            NotifyInventory: ({ personId }) =>
              this.broadcast(personId, LiveFrame.members[1].make({})).pipe(
                Effect.as(null)
              ),
            Publish: ({ change, personId }) =>
              this.broadcast(personId, change).pipe(Effect.as(null)),
            Push: (delivery) =>
              LiveSyncPolicy.pipe(
                Effect.flatMap((syncPolicy) =>
                  this.jobs.enqueue(delivery.work, now, syncPolicy.debounceMs, {
                    id: delivery.channelId,
                    number: delivery.number,
                  })
                ),
                Effect.map((accepted) =>
                  LiveOutput.cases.Queued.make({ accepted })
                )
              ),
            Reconcile: () =>
              this.synchronize(LiveWork.cases.Inventory.make({})),
            StopAccount: ({ accountId }) => this.stopAccount(accountId),
            Sync: ({ ref }) =>
              this.synchronize(LiveWork.cases.Calendar.make(ref)),
          });
        }
      );
    }

    // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare invokes the Durable Object fetch boundary through a native Promise.
    async fetch(request: Request): Promise<Response> {
      const { config } = await this.ready;
      const path = new URL(request.url).pathname;

      if (
        path === "/live" &&
        request.headers.get("upgrade")?.toLowerCase() === "websocket"
      ) {
        const personId = request.headers.get("x-calendar-person");

        if (
          personId === null ||
          request.headers.get("origin") !== config.baseURL
        ) {
          return new Response(null, { status: 404 });
        }

        await Effect.runPromise(this.owned(personId));
        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
        this.state.acceptWebSocket(server);
        server.serializeAttachment({ personId });
        await Effect.runPromise(
          this.jobs.enqueue(
            LiveWork.cases.Inventory.make({}),
            await Effect.runPromise(Clock.currentTimeMillis),
            0
          )
        );
        const upgrade = { status: 101, webSocket: client };

        return new Response(null, upgrade);
      }

      if (path !== "/calendar-live" || request.method !== "POST") {
        return new Response(null, { status: 404 });
      }

      const result = await Effect.runPromise(
        Effect.gen({ self: this }, function* commandReply() {
          const raw: unknown = yield* Effect.tryPromise({
            catch: unavailable,

            // oxlint-disable-next-line typescript/promise-function-async -- Effect owns cancellation; native Promise adapter
            try: () => request.json(),
          });

          const command = yield* Schema.decodeUnknownEffect(
            Schema.toCodecJson(LiveCommand)
          )(raw).pipe(Effect.mapError(unavailable));

          return yield* this.command(command);
        }).pipe(Effect.result)
      );

      const reply = Result.isFailure(result)
        ? LiveReply.cases.Failure.make({ failure: result.failure })
        : LiveReply.cases.Success.make({ value: result.success });

      const encoded = await Effect.runPromise(
        Schema.encodeEffect(Schema.toCodecJson(LiveReply))(reply).pipe(
          Effect.orDie
        )
      );

      if (this.admission.accepts()) {
        await Effect.runPromise(
          this.jobs.schedule(await Effect.runPromise(Clock.currentTimeMillis))
        );
      }

      return Response.json(encoded);
    }

    // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare invokes alarms through a native Promise; durable work remains in SQLite until completion.
    async alarm(): Promise<void> {
      const { coordinator } = await this.ready;

      await Effect.runPromise(
        Effect.gen({ self: this }, function* drainAlarm() {
          const owner = yield* this.jobs.owner.pipe(Effect.result);

          if (Result.isFailure(owner)) {
            return;
          }

          if (
            (yield* this.personStatus(owner.success.personId)) === "missing"
          ) {
            yield* this.forgetPerson();

            return;
          }

          const due = yield* this.jobs.due(yield* Clock.currentTimeMillis);

          for (const job of due) {
            yield* coordinator.run(job.key).pipe(Effect.result);
          }

          if (
            (yield* this.personStatus(owner.success.personId)) === "missing"
          ) {
            yield* this.forgetPerson();
          } else if (this.admission.accepts()) {
            yield* this.jobs.schedule(yield* Clock.currentTimeMillis);
          }
        })
      );
    }

    webSocketMessage(
      socket: WorkerWebSocket,
      message: string | ArrayBuffer
    ): void {
      if (!this.state.getWebSockets().includes(socket)) {
        return;
      }

      if (message === "ping") {
        socket.send("pong");

        return;
      }

      socket.close(1008, "Observer connections do not accept commands");
    }

    webSocketClose(socket: WorkerWebSocket): void {
      if (!this.state.getWebSockets().includes(socket)) {
        return;
      }

      socket.close(1000, "Closed");
    }
    webSocketError(socket: WorkerWebSocket): void {
      if (!this.state.getWebSockets().includes(socket)) {
        return;
      }

      socket.close(1011, "Observer unavailable");
    }
  };

export const CalendarLive = calendarLiveClass("production");
