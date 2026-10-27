import {
  deskDefaultMacNotificationSettingsUrl,
  NotificationSettingsRequest,
  NotificationSettingsReply,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Schema } from "effect";

import { DesktopError } from "../src/config.js";
import { runNotificationSettings } from "../src/notification-settings.js";

it.effect.prop(
  "notification settings histories open exactly once per trusted Mac Open and never on Read",
  {
    actions: Schema.Array(Schema.Boolean).check(Schema.isMaxLength(15)),
    macOS: Schema.Boolean,
    supported: Schema.Boolean,
    trusted: Schema.Boolean,
  },
  ({ macOS, supported, trusted, actions }) =>
    Effect.gen(function* notificationSettingsHistory() {
      const calls: string[] = [];
      let reads = 0;
      let expectedCalls = 0;

      const port = {
        macOS,
        open: (url: string) =>
          Effect.sync(() => {
            calls.push(url);
          }),
        supported: Effect.sync(() => {
          reads += 1;

          return supported;
        }),
        trusted: Effect.succeed(trusted),
      };

      for (const open of actions) {
        const reply = yield* runNotificationSettings(
          open
            ? NotificationSettingsRequest.cases.Open.make({ version: 1 })
            : NotificationSettingsRequest.cases.Read.make({ version: 1 }),
          port
        );

        if (trusted && macOS && open) {
          expectedCalls += 1;
        }

        expect(calls).toEqual(
          Array.from(
            { length: expectedCalls },
            () => deskDefaultMacNotificationSettingsUrl.url
          )
        );

        if (!trusted) {
          expect(reply._tag).toBe("Failed");
        } else if (!macOS) {
          expect(reply._tag).toBe("Unavailable");
        } else if (open) {
          expect(reply._tag).toBe("Requested");
        } else {
          expect(reply).toEqual(
            NotificationSettingsReply.cases.Read.make({
              permission: { authorization: "unknown", supported },
              version: 1,
            })
          );
        }
      }

      expect(reads).toBe(
        trusted && macOS ? actions.filter((open) => !open).length : 0
      );
    })
);

it.effect(
  "a pending native handoff cannot acknowledge Requested until the actual shell port completes",
  () =>
    Effect.gen(function* pendingSettingsHandoff() {
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      const scope = yield* Effect.scope;

      const task = yield* runNotificationSettings(
        NotificationSettingsRequest.cases.Open.make({ version: 1 }),
        {
          macOS: true,
          open: () =>
            Deferred.succeed(entered, true).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.asVoid
            ),
          supported: Effect.succeed(true),
          trusted: Effect.succeed(true),
        }
      ).pipe(Effect.forkIn(scope));

      yield* Deferred.await(entered);
      expect(task.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(release, true);
      expect(yield* Fiber.join(task)).toEqual(
        NotificationSettingsReply.cases.Requested.make({ version: 1 })
      );
    }).pipe(Effect.scoped)
);

it.effect(
  "handoff failures stay Failed and a revoked frame never reaches the shell",
  () =>
    Effect.gen(function* failedSettingsHandoff() {
      let checks = 0;
      let calls = 0;

      const failed = yield* runNotificationSettings(
        NotificationSettingsRequest.cases.Open.make({ version: 1 }),
        {
          macOS: true,
          open: () =>
            Effect.fail(
              new DesktopError({ message: "Settings handoff failed" })
            ),
          supported: Effect.succeed(true),
          trusted: Effect.succeed(true),
        }
      );

      expect(failed).toEqual(
        NotificationSettingsReply.cases.Failed.make({
          message: "Settings handoff failed",
          version: 1,
        })
      );

      const revoked = yield* runNotificationSettings(
        NotificationSettingsRequest.cases.Open.make({ version: 1 }),
        {
          macOS: true,
          open: () =>
            Effect.sync(() => {
              calls += 1;
            }),
          supported: Effect.succeed(true),
          trusted: Effect.sync(() => {
            checks += 1;

            return checks === 1;
          }),
        }
      );

      expect(revoked._tag).toBe("Failed");
      expect(calls).toBe(0);
    })
);
