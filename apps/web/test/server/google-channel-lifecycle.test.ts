import {
  GoogleCalendarClient,
  GoogleHttp,
  GoogleRetryPolicy,
  GoogleTokens,
  Provider,
} from "@calendar/calendar";
import type { GoogleRequestValue } from "@calendar/calendar";
import type { PushResourceValue } from "@calendar/database/google-push";
import { BrowserCrypto } from "@effect/platform-browser";
import { expect, it } from "@effect/vitest";
import {
  Cause,
  Clock,
  Effect,
  Exit,
  Fiber,
  Layer,
  Redacted,
  Ref,
  Schema,
} from "effect";

import {
  ChannelLifecycle,
  runGoogleChannelLifecycle,
  renewGoogleChannel,
  tokenHash,
} from "../../src/server/google-channel-lifecycle.js";
import { maintainGoogleChannels } from "../../src/server/google-channel-maintenance.js";
import { seededPushRepository } from "./google-push-fixture.js";
import { memoryMaintenanceState } from "./maintenance-state-fixture.js";

const channelCompletionCause = (prepare: Effect.Effect<never, Provider>) =>
  Effect.gen(function* completionCause() {
    const fiber = yield* runGoogleChannelLifecycle().pipe(
      Effect.provideService(ChannelLifecycle, {
        prepare: () => prepare,
        stopPrevious: () => Effect.void,
        watch: () =>
          Effect.die(new Error("Preparation must stop this lifecycle")),
      }),
      Effect.forkScoped
    );

    const exit = yield* Fiber.await(fiber);

    if (Exit.isSuccess(exit)) {
      return yield* Effect.die(
        new Error("The failing preparation unexpectedly completed")
      );
    }

    return exit.cause;
  });

it.effect(
  "channel actor completion preserves typed failure, defect, and interruption",
  () =>
    Effect.gen(function* actorErrorKinds() {
      const typed = new Provider({
        message: "Fixture failure",
        operation: "fixture",
        status: 503,
      });

      const typedCause = yield* channelCompletionCause(Effect.fail(typed));
      expect(Cause.hasFails(typedCause)).toBe(true);
      expect(Cause.hasDies(typedCause)).toBe(false);
      expect(Cause.squash(typedCause)).toBeInstanceOf(Provider);
      const defect = new Error("Fixture actor defect");
      const defectCause = yield* channelCompletionCause(Effect.die(defect));
      expect(Cause.hasDies(defectCause)).toBe(true);
      expect(Cause.squash(defectCause)).toBe(defect);
      const interruption = yield* channelCompletionCause(Effect.interrupt);
      expect(Cause.hasInterruptsOnly(interruption)).toBe(true);
    })
);

const resource: PushResourceValue = {
  accountId: "person-a-google",
  calendarId: "primary",
  kind: "events",
};

const Registration = Schema.Struct({
  address: Schema.String,
  id: Schema.String,
  params: Schema.Struct({ ttl: Schema.String }),
  token: Schema.String,
});

it.effect(
  "renewal persists pending before watch, retains response expiry, overlaps before stop and recovers a failed stop",
  () =>
    Effect.gen(function* renewAndRecover() {
      const { repository } = yield* seededPushRepository;
      const maintenance = (yield* memoryMaintenanceState).make();
      const calls = yield* Ref.make<readonly string[]>([]);
      const stopFails = yield* Ref.make(false);
      const omitExpiry = yield* Ref.make(false);

      const http = Layer.succeed(GoogleHttp, {
        execute: Effect.fn("test.googleWatch")(function* execute(
          request: GoogleRequestValue
        ) {
          if (request.path === "/channels/stop") {
            const body = yield* Schema.decodeEffect(
              Schema.fromJsonString(Schema.Struct({ id: Schema.String }))
            )(request.body ?? "").pipe(Effect.orDie);

            const active = yield* repository
              .active("person-a", resource)
              .pipe(Effect.orDie);

            expect(active?.id).not.toBe(body.id);
            expect(
              yield* repository.delivery(body.id, 0).pipe(Effect.orDie)
            ).toBeNull();
            yield* Ref.update(calls, (values) => [
              ...values,
              `stop:${body.id}`,
            ]);

            return {
              body: "",
              retryAfterMs: 0,
              status: (yield* Ref.get(stopFails)) ? 400 : 204,
            };
          }

          const registration = yield* Schema.decodeEffect(
            Schema.fromJsonString(Registration)
          )(request.body ?? "").pipe(Effect.orDie);

          const pending = yield* repository
            .delivery(registration.id, 0)
            .pipe(Effect.orDie);

          expect(pending?.state).toBe("pending");
          expect(pending?.tokenHash).toBe(
            yield* tokenHash(registration.token).pipe(Effect.orDie)
          );
          expect(registration.params.ttl).toBe("604800");
          expect(registration.address).toBe(
            "https://calendar.wzrrd.sh/google/push"
          );
          yield* Ref.update(calls, (values) => [
            ...values,
            `watch:${registration.id}`,
          ]);

          const identity = {
            id: registration.id,
            resourceId: `resource-${registration.id}`,
          };

          const response = (yield* Ref.get(omitExpiry))
            ? identity
            : {
                ...identity,
                expiration: String((yield* Clock.currentTimeMillis) + 300_000),
              };

          return {
            body: JSON.stringify(response),
            retryAfterMs: 0,
            status: 200,
          };
        }),
      });

      const tokens = Layer.succeed(GoogleTokens, {
        accessToken: () => Effect.succeed(Redacted.make("fake-token")),
        accounts: () =>
          Effect.succeed([
            {
              disconnected: false,
              email: "person-a@example.test",
              id: "person-a-google",
            },
          ]),
      });

      const google = GoogleCalendarClient.layer.pipe(
        Layer.provide(BrowserCrypto.layer),
        Layer.provide(http),
        Layer.provide(tokens)
      );

      const services = Layer.mergeAll(http, tokens, google);
      yield* Effect.gen(function* channelHistory() {
        yield* renewGoogleChannel(
          repository,
          "person-a",
          resource,
          "https://calendar.wzrrd.sh/google/push"
        );
        const old = yield* repository.active("person-a", resource);
        expect(old?.expiresAt).toBe(300_000);
        yield* Ref.set(omitExpiry, true);

        const missingExpiry = yield* renewGoogleChannel(
          repository,
          "person-a",
          resource,
          "https://calendar.wzrrd.sh/google/push",
          old
        ).pipe(Effect.flip);

        expect(missingExpiry._tag).toBe("Provider");
        expect((yield* repository.active("person-a", resource))?.id).toBe(
          old?.id
        );
        yield* Ref.set(omitExpiry, false);
        yield* Ref.set(stopFails, true);

        const failed = yield* renewGoogleChannel(
          repository,
          "person-a",
          resource,
          "https://calendar.wzrrd.sh/google/push",
          old
        ).pipe(Effect.flip);

        expect(failed._tag).toBe("Provider");
        const replacement = yield* repository.active("person-a", resource);
        expect(replacement?.id).not.toBe(old?.id);
        const history = yield* Ref.get(calls);
        expect(history.map((entry) => entry.split(":")[0])).toEqual([
          "watch",
          "watch",
          "stop",
          "watch",
          "stop",
        ]);

        const cleanupFailure = yield* maintainGoogleChannels(
          repository,
          "person-a",
          {
            accounts: [
              {
                accountId: "person-a-google",
                calendars: [
                  {
                    ...resource,
                    accessRole: "owner",
                    primary: true,
                    timeZone: "UTC",
                    title: "Primary",
                  },
                ],
                colors: { calendar: {}, event: {} },
              },
            ],
          },
          "https://calendar.wzrrd.sh/google/push",
          maintenance
        ).pipe(Effect.flip);

        expect(cleanupFailure._tag).toBe("Provider");
        expect(
          yield* maintenance.blocked(resource, yield* Clock.currentTimeMillis)
        ).toBe(false);
        yield* Ref.set(stopFails, false);
        yield* maintainGoogleChannels(
          repository,
          "person-a",
          {
            accounts: [
              {
                accountId: "person-a-google",
                calendars: [],
                colors: { calendar: {}, event: {} },
              },
            ],
          },
          "https://calendar.wzrrd.sh/google/push",
          maintenance
        );
        expect(yield* repository.active("person-a", resource)).toBeUndefined();
        expect(
          (yield* repository.list("person-a")).every(
            (channel) => channel.kind === "calendarList"
          )
        ).toBe(true);
      }).pipe(
        Effect.provide(services),
        Effect.provideService(GoogleRetryPolicy, { baseDelayMs: 0, retries: 0 })
      );
    })
);
