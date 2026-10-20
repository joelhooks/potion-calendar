import {
  GoogleCalendarClient,
  GoogleHttp,
  GoogleTokens,
  Provider,
  googleRequest,
} from "@calendar/calendar";
import type { CalendarFailureValue } from "@calendar/calendar";
import { CalendarFailure } from "@calendar/calendar/contracts";
import { watchActor } from "@calendar/capability/actor-watch";
import type {
  GooglePushRepository,
  PushChannelValue,
  PushResourceValue,
} from "@calendar/database/google-push";
import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import {
  EffectInterruptedError,
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import {
  Cause,
  Clock,
  Context,
  Crypto,
  Effect,
  Option,
  Predicate,
  Redacted,
  Schema,
} from "effect";
import { types } from "xstate";

export const googleChannelTtlSeconds = 604_800;

export const channelRenewalLeadMs = 30 * 60 * 1000;

const WatchResponse = Schema.Struct({
  expiration: Schema.optionalKey(
    Schema.Union([Schema.Int, Schema.FiniteFromString.check(Schema.isInt())])
  ),
  id: Schema.NonEmptyString,
  resourceId: Schema.NonEmptyString,
});

interface Prepared {
  readonly channel: PushChannelValue;
  readonly token: Redacted.Redacted;
}

interface Activated {
  readonly channel: PushChannelValue;
  readonly predecessor: PushChannelValue | undefined;
}

interface LifecycleContext {
  readonly prepared: Prepared | undefined;
  readonly activated: Activated | undefined;
  readonly error:
    | CalendarFailureValue
    | Cause.UnknownError
    | EffectInterruptedError
    | undefined;
}

export class ChannelLifecycle extends Context.Service<
  ChannelLifecycle,
  {
    readonly prepare: () => Effect.Effect<Prepared, CalendarFailureValue>;
    readonly watch: (
      input: Prepared
    ) => Effect.Effect<Activated, CalendarFailureValue>;
    readonly stopPrevious: (
      input: Activated
    ) => Effect.Effect<void, CalendarFailureValue>;
  }
>()("@calendar/web/ChannelLifecycle") {}

const ChannelActorError = Schema.Union([
  CalendarFailure,
  Schema.instanceOf(EffectInterruptedError),
]);

const channelActorError = (error: CalendarFailureValue) =>
  Schema.decodeOption(ChannelActorError)(error).pipe(
    Option.getOrElse(
      () => new Cause.UnknownError(error, "Google channel actor defect")
    )
  );

const prepareChannel = createEffectLogic({
  effect: ChannelLifecycle.use((service) => service.prepare()),
});

const watchChannel = createEffectLogic({
  effect: ({ input }) =>
    ChannelLifecycle.use((service) => service.watch(input)),
  schemas: { input: types<Prepared>() },
});

const stopPredecessor = createEffectLogic({
  effect: ({ input }) =>
    ChannelLifecycle.use((service) => service.stopPrevious(input)),
  schemas: { input: types<Activated>() },
});

export const googleChannelMachine = setupEffect({
  actors: { prepareChannel, stopPredecessor, watchChannel },
  schemas: { context: types<LifecycleContext>() },
}).createMachine({
  context: { activated: undefined, error: undefined, prepared: undefined },
  initial: "preparing",
  output: ({ context }) => context.error,
  states: {
    active: { type: "final" },
    failed: { type: "final" },
    preparing: {
      invoke: {
        onDone: {
          context: ({ event }) => ({ prepared: event.output }),
          target: "watching",
        },
        onError: {
          context: ({ event }) => ({ error: channelActorError(event.error) }),
          target: "failed",
        },
        src: "prepareChannel",
      },
    },
    stoppingPrevious: {
      invoke: {
        input: ({ context }) => {
          if (context.activated === undefined) {
            throw new Error("Missing active Google channel");
          }

          return context.activated;
        },
        onDone: { target: "active" },
        onError: {
          context: ({ event }) => ({ error: channelActorError(event.error) }),
          target: "failed",
        },
        src: "stopPredecessor",
      },
    },
    watching: {
      invoke: {
        input: ({ context }) => {
          if (context.prepared === undefined) {
            throw new Error("Missing prepared Google channel");
          }

          return context.prepared;
        },
        onDone: {
          context: ({ event }) => ({ activated: event.output }),
          target: "stoppingPrevious",
        },
        onError: {
          context: ({ event }) => ({ error: channelActorError(event.error) }),
          target: "failed",
        },
        src: "watchChannel",
      },
    },
  },
});

export const runGoogleChannelLifecycle = Effect.fn("runGoogleChannelLifecycle")(
  function* runGoogleChannelLifecycle() {
    const actor = yield* createEffectActor(googleChannelMachine);
    yield* watchActor("googleChannelLifecycle", actor);
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Actor crashes remain defects; onError outcomes are decoded separately.
    const failure = yield* join(actor).pipe(Effect.orDie);

    if (failure === undefined) {
      return yield* Effect.void;
    }

    if (Cause.isUnknownError(failure)) {
      return yield* Effect.die(failure.cause);
    }

    if (Predicate.isTagged(failure, "EffectInterruptedError")) {
      return yield* Effect.failCause(failure.cause);
    }

    // @effect-diagnostics-next-line unnecessaryFailYieldableError:off -- Actor completion propagates decoded failures explicitly rather than depending on error iterability.
    return yield* Effect.fail(failure);
  },
  Effect.scoped
);

const storeFailure = () =>
  new Provider({
    message: "Google channel storage is unavailable",
    operation: "watch",
    status: 0,
  });

const invalidResponse = () =>
  new Provider({
    message: "Google watch omitted valid channel identity or expiry",
    operation: "watch",
    status: 200,
  });

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

export const tokenHash = (token: string) =>
  Crypto.Crypto.use((crypto) =>
    crypto.digest("SHA-256", new TextEncoder().encode(token))
  ).pipe(
    Effect.map(hex),
    Effect.provide(BrowserCrypto.layer),
    Effect.mapError(storeFailure)
  );

export const renewGoogleChannel = Effect.fn("renewGoogleChannel")(
  function* renewGoogleChannel(
    repository: GooglePushRepository,
    personId: string,
    resource: PushResourceValue,
    address: string,
    predecessor?: PushChannelValue
  ) {
    const crypto = yield* Crypto.Crypto;
    const google = yield* GoogleCalendarClient;
    const http = yield* GoogleHttp;
    const tokens = yield* GoogleTokens;

    const prepare = Effect.fn("channel.prepare")(function* prepare() {
      const id = yield* crypto.randomUUIDv4.pipe(Effect.mapError(storeFailure));

      const bytes = yield* crypto
        .randomBytes(32)
        .pipe(Effect.mapError(storeFailure));

      const token = Redacted.make(hex(bytes));
      const hash = yield* tokenHash(Redacted.value(token));
      const now = yield* Clock.currentTimeMillis;

      const channel: PushChannelValue = {
        ...resource,
        createdAt: now,
        expiresAt: now + googleChannelTtlSeconds * 1000,
        id,
        personId,
        predecessorId: predecessor?.id ?? null,
        resourceId: null,
        state: "pending",
        tokenHash: hash,
      };

      yield* repository
        .insertPending(channel)
        .pipe(Effect.mapError(storeFailure));

      return { channel, token };
    });

    const watch = Effect.fn("channel.watch")(function* watch(
      prepared: Prepared
    ) {
      const result = yield* googleRequest({
        accountId: resource.accountId,
        body: JSON.stringify({
          address,
          id: prepared.channel.id,
          params: { ttl: String(googleChannelTtlSeconds) },
          token: Redacted.value(prepared.token),
          type: "web_hook",
        }),
        method: "POST",
        path:
          resource.kind === "events"
            ? `/calendars/${encodeURIComponent(resource.calendarId)}/events/watch`
            : "/users/me/calendarList/watch",
      }).pipe(
        Effect.provideService(GoogleHttp, http),
        Effect.provideService(GoogleTokens, tokens),
        Effect.flatMap((response) =>
          Schema.decodeEffect(Schema.fromJsonString(WatchResponse))(
            response.body
          ).pipe(Effect.mapError(invalidResponse))
        ),
        Effect.tapError(() =>
          repository
            .finish(personId, prepared.channel.id, "orphaned")
            .pipe(Effect.mapError(storeFailure))
        )
      );

      const now = yield* Clock.currentTimeMillis;

      if (
        result.id !== prepared.channel.id ||
        result.expiration === undefined ||
        result.expiration <= now
      ) {
        yield* repository
          .retireObserved(personId, prepared.channel.id, result.resourceId)
          .pipe(Effect.mapError(storeFailure));
        yield* google.stopWatch(
          resource.accountId,
          prepared.channel.id,
          result.resourceId
        );
        yield* repository
          .finish(personId, prepared.channel.id, "stopped")
          .pipe(Effect.mapError(storeFailure));

        return yield* invalidResponse();
      }

      const accepted = yield* repository
        .activate({
          expiresAt: result.expiration,
          id: result.id,
          personId,
          predecessorId: predecessor?.id ?? null,
          resourceId: result.resourceId,
        })
        .pipe(Effect.mapError(storeFailure));

      if (!accepted) {
        return yield* storeFailure();
      }

      return {
        channel: {
          ...prepared.channel,
          expiresAt: result.expiration,
          resourceId: result.resourceId,
          state: "active" as const,
        },
        predecessor,
      };
    });

    const stopPrevious = Effect.fn("channel.stopPrevious")(
      function* stopPrevious(input: Activated) {
        if (
          input.predecessor?.resourceId !== null &&
          input.predecessor?.resourceId !== undefined
        ) {
          yield* google.stopWatch(
            input.predecessor.accountId,
            input.predecessor.id,
            input.predecessor.resourceId
          );
          yield* repository
            .finish(personId, input.predecessor.id, "stopped")
            .pipe(Effect.mapError(storeFailure));
        }
      }
    );

    return yield* runGoogleChannelLifecycle().pipe(
      Effect.provideService(ChannelLifecycle, { prepare, stopPrevious, watch })
    );
  },
  Effect.provide(BrowserCrypto.layer),
  Effect.scoped
);
