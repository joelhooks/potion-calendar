import { watchActor } from "@calendar/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import {
  Context,
  Effect,
  Layer,
  Option,
  Predicate,
  Redacted,
  Schema,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { types } from "xstate";

import { calendarActorFailure } from "./calendar-actor-failure.js";
import { Gone, NotFound, Provider, RateLimited, Revoked } from "./errors.js";
import type { CalendarFailureValue } from "./errors.js";
import { GoogleTokens, tokenFailure } from "./google-tokens.js";
import { GoogleFailureReason } from "./provider.js";

export const GoogleRequest = Schema.Struct({
  acceptConflict: Schema.optional(Schema.Boolean),
  accountId: Schema.String,
  body: Schema.optional(Schema.String),
  method: Schema.Literals(["GET", "POST", "PATCH", "DELETE"]),
  path: Schema.String,
});

export type GoogleRequestValue = typeof GoogleRequest.Type;

export interface GoogleResponse {
  readonly status: number;
  readonly body: string;
  readonly retryAfterMs: number;
}

export class GoogleHttp extends Context.Service<
  GoogleHttp,
  {
    readonly execute: (
      request: GoogleRequestValue,
      bearer: string
    ) => Effect.Effect<GoogleResponse, Provider>;
  }
>()("@calendar/calendar/GoogleHttp") {
  static readonly layer = Layer.effect(
    GoogleHttp,
    Effect.gen(function* layer() {
      const client = yield* HttpClient.HttpClient;

      return GoogleHttp.of({
        execute: Effect.fn("GoogleHttp.execute")(
          function* execute(request, bearer) {
            const base = HttpClientRequest.make(request.method)(
              `https://www.googleapis.com/calendar/v3${request.path}`
            ).pipe(HttpClientRequest.bearerToken(bearer));

            const outgoing =
              request.body === undefined
                ? base
                : HttpClientRequest.bodyText(
                    base,
                    request.body,
                    "application/json"
                  );

            const response = yield* client.execute(outgoing).pipe(
              Effect.mapError(
                () =>
                  new Provider({
                    message: "Calendar transport failed; retry the operation",
                    operation: request.method,
                    status: 0,
                  })
              )
            );

            const body = yield* response.text.pipe(
              Effect.mapError(
                () =>
                  new Provider({
                    message: "Calendar response body could not be read",
                    operation: request.method,
                    status: response.status,
                  })
              )
            );

            const seconds = Number(response.headers["retry-after"] ?? "0");

            return {
              body,
              retryAfterMs:
                Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
              status: response.status,
            };
          }
        ),
      });
    })
  );
}

export const GoogleRetryPolicy = Context.Reference<{
  readonly retries: number;
  readonly baseDelayMs: number;
}>("@calendar/calendar/GoogleRetryPolicy", {
  defaultValue: () => ({ baseDelayMs: 1000, retries: 3 }),
});

type RequestOutcome =
  | { readonly response: GoogleResponse }
  | { readonly error: CalendarFailureValue };

interface RequestContext {
  readonly request: GoogleRequestValue;
  readonly refreshed: boolean;
  readonly attempt: number;
  readonly delayMs: number;
  readonly outcome: RequestOutcome | undefined;
}

const performRequest = createEffectLogic({
  effect: Effect.fn("performGoogleRequest")(function* effect({ input }) {
    const tokens = yield* GoogleTokens;
    const http = yield* GoogleHttp;

    const bearer = yield* tokens
      .accessToken(input.request.accountId, {
        forceRefresh: input.refreshed && input.attempt === 0,
      })
      .pipe(Effect.mapError(tokenFailure));

    return yield* http.execute(input.request, Redacted.value(bearer));
  }),
  schemas: {
    input: Schema.Struct({
      attempt: Schema.Finite,
      refreshed: Schema.Boolean,
      request: GoogleRequest,
    }),
  },
});

const pauseRequest = createEffectLogic({
  effect: ({ input }) => Effect.sleep(input.delayMs),
  schemas: { input: Schema.Struct({ delayMs: Schema.Finite }) },
});

const GoogleErrorReason = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.Struct({
      errors: Schema.Array(
        Schema.Struct({
          reason: GoogleFailureReason,
        })
      ),
    }),
  })
);

const classifyResponse = (
  request: GoogleRequestValue,
  response: GoogleResponse
): CalendarFailureValue => {
  const eventWatch =
    request.method === "POST" &&
    request.path.startsWith("/calendars/") &&
    request.path.endsWith("/events/watch");

  const operation = eventWatch ? "events.watch" : request.method;
  const decoded = Schema.decodeOption(GoogleErrorReason)(response.body);

  const reasons = decoded.pipe(
    Option.map((value) => value.error.errors.map((entry) => entry.reason)),
    Option.getOrUndefined
  );

  const provider = () =>
    new Provider({
      message: "Google rejected the operation; inspect permissions or retry",
      operation,
      reason: reasons?.[0],
      reasons,
      status: response.status,
    });

  if (
    eventWatch &&
    response.status >= 400 &&
    response.status < 500 &&
    ![401, 403, 429].includes(response.status)
  ) {
    return provider();
  }

  switch (response.status) {
    case 401: {
      return new Revoked({ accountId: request.accountId });
    }

    case 404: {
      return new NotFound({ operation });
    }

    case 410: {
      return new Gone({ operation });
    }

    case 429: {
      return new RateLimited({
        operation,
        retryAfterMs: response.retryAfterMs,
      });
    }

    default: {
      return provider();
    }
  }
};

const requestMachine = setupEffect({
  actors: { pauseRequest, performRequest },
  schemas: {
    context: types<
      RequestContext & {
        readonly retries: number;
        readonly baseDelayMs: number;
      }
    >(),
    input: Schema.Struct({
      baseDelayMs: Schema.Finite,
      request: GoogleRequest,
      retries: Schema.Finite,
    }),
  },
}).createMachine({
  context: ({ input }) => ({
    ...input,
    attempt: 0,
    delayMs: 0,
    outcome: undefined,
    refreshed: false,
  }),
  initial: "requesting",
  output: ({ context }) => context.outcome,
  states: {
    backoff: {
      invoke: {
        input: ({ context }) => ({ delayMs: context.delayMs }),
        onDone: { target: "requesting" },
        src: "pauseRequest",
      },
    },
    requesting: {
      invoke: {
        input: ({ context }) => context,
        onDone: ({ context, event }) => {
          const response = event.output;

          if (
            (response.status >= 200 && response.status < 300) ||
            (response.status === 409 && context.request.acceptConflict === true)
          ) {
            return { context: { outcome: { response } }, target: "settled" };
          }

          if (response.status === 401 && !context.refreshed) {
            return {
              context: { attempt: 0, refreshed: true },
              reenter: true,
              target: "requesting",
            };
          }

          if (
            (response.status === 429 || response.status >= 500) &&
            context.attempt < context.retries
          ) {
            return {
              context: {
                attempt: context.attempt + 1,
                delayMs: Math.max(
                  response.retryAfterMs,
                  context.baseDelayMs * 2 ** context.attempt
                ),
              },
              target: "backoff",
            };
          }

          return {
            context: {
              outcome: { error: classifyResponse(context.request, response) },
            },
            target: "settled",
          };
        },
        onError: ({ context, event }) => {
          if (
            Predicate.isTagged(event.error, "Provider") &&
            event.error.status === 0 &&
            context.attempt < context.retries
          ) {
            return {
              context: {
                attempt: context.attempt + 1,
                delayMs: context.baseDelayMs * 2 ** context.attempt,
              },
              target: "backoff",
            };
          }

          return {
            context: { outcome: { error: event.error } },
            target: "settled",
          };
        },
        src: "performRequest",
      },
    },
    settled: { type: "final" },
  },
});

export const googleRequest = Effect.fn("googleRequest")(function* googleRequest(
  request: GoogleRequestValue
) {
  const policy = yield* GoogleRetryPolicy;

  const actor = yield* createEffectActor(requestMachine, {
    input: { request, ...policy },
  });

  yield* watchActor("googleRequest", actor);
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Domain errors travel in the outcome; unexpected machine errors remain defects.
  const outcome = yield* join(actor).pipe(Effect.orDie);

  if (outcome === undefined) {
    return yield* Effect.die(
      new Error("Google request finished without an outcome")
    );
  }

  if ("error" in outcome) {
    return yield* calendarActorFailure(outcome.error);
  }

  return outcome.response;
}, Effect.scoped);
