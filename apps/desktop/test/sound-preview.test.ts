import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Deferred, Effect, Fiber, Ref, Schema } from "effect";

import { DesktopError } from "../src/config.js";
import { previewWithSound, soundPreviewEnabled } from "../src/sound-machine.js";

it.effect.prop(
  "preview never prepares for visible prompts or No sound and never reveals a window",
  {
    active: Arbitrary.schema(Schema.Boolean),
    enabled: Arbitrary.schema(Schema.Boolean),
    failed: Arbitrary.schema(Schema.Boolean),
    sound: Arbitrary.schema(Schema.Literals(["none", "blip", "bell", "tap"])),
  },
  ({ active, enabled, failed, sound }) =>
    Effect.gen(function* previewHistory() {
      const calls = yield* Ref.make<string[]>([]);

      const result = yield* previewWithSound(sound, {
        active: Effect.succeed(active),
        enabled: Effect.succeed(enabled),
        prepare: Ref.update(calls, (rows) => [...rows, "prepareHidden"]).pipe(
          Effect.as({
            cancel: Ref.update(calls, (rows) => [...rows, "cancel"]),
            load: () =>
              Ref.update(calls, (rows) => [...rows, "load"]).pipe(
                Effect.andThen(
                  failed
                    ? Effect.fail(
                        new DesktopError({ message: "Audio refused" })
                      )
                    : Effect.void
                )
              ),
            play: () => Ref.update(calls, (rows) => [...rows, "play"]),
          })
        ),
      });

      const suppressed = active || !enabled || sound === "none";
      expect(result).toBe(!suppressed && !failed);

      const attempted = failed
        ? ["prepareHidden", "load", "cancel"]
        : ["prepareHidden", "load", "play", "cancel"];

      expect(yield* Ref.get(calls)).toEqual(suppressed ? [] : attempted);
    })
);

it.effect.prop(
  "native preview eligibility rechecks current menu, notification and accepted tone ownership",
  {
    menuBar: Arbitrary.schema(Schema.Boolean),
    notifications: Arbitrary.schema(Schema.Boolean),
    sameTone: Arbitrary.schema(Schema.Boolean),
    sound: Arbitrary.schema(Schema.Literals(["none", "blip", "bell", "tap"])),
  },
  ({ menuBar, notifications, sameTone, sound }) =>
    Effect.sync(() => {
      const otherTone = sound === "blip" ? "bell" : "blip";

      const preferences = {
        ...defaultDesktopPreferences(),
        menuBar,
        promptMinutes: notifications ? 1 : null,
        promptSound: sameTone ? sound : otherTone,
      } satisfies ReturnType<typeof defaultDesktopPreferences>;

      expect(soundPreviewEnabled(preferences, sound)).toBe(
        menuBar && notifications && sameTone && sound !== "none"
      );
    })
);

it.effect.each(["visible", "disabled"] as const)(
  "a prompt becoming %s while preview loads suppresses the late play attempt",
  (change) =>
    Effect.gen(function* previewVisibilityRace() {
      const active = yield* Ref.make(false);
      const enabled = yield* Ref.make(true);
      const entered = yield* Deferred.make<boolean>();
      const ready = yield* Deferred.make<boolean>();
      const played = yield* Ref.make(0);
      const cancelled = yield* Ref.make(0);

      const fiber = yield* previewWithSound("bell", {
        active: Ref.get(active),
        enabled: Ref.get(enabled),
        prepare: Effect.succeed({
          cancel: Ref.update(cancelled, (count) => count + 1),
          load: () =>
            Deferred.succeed(entered, true).pipe(
              Effect.andThen(Deferred.await(ready)),
              Effect.asVoid
            ),
          play: () => Ref.update(played, (count) => count + 1),
        }),
      }).pipe(Effect.forkChild);

      yield* Deferred.await(entered);
      yield* change === "visible"
        ? Ref.set(active, true)
        : Ref.set(enabled, false);
      yield* Deferred.succeed(ready, true);
      expect(yield* Fiber.join(fiber)).toBe(false);
      expect(yield* Ref.get(played)).toBe(0);
      expect(yield* Ref.get(cancelled)).toBe(1);
    })
);
