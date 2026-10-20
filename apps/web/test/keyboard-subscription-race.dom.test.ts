import { expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import type { Subscription } from "foldkit";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { subscriptions } from "../src/client/subscriptions.js";
import { keyboardFixture } from "./keyboard-fixture.js";

type KeyboardEntry = Subscription.Subscription<
  AppModel,
  AppMessage,
  { model: AppModel },
  EditingRuntime | SearchRuntime
>;

const dependencyEquivalence = (entry: KeyboardEntry) =>
  entry.keepAliveEquivalence ?? Schema.toEquivalence(entry.dependenciesSchema);

const unusedRuntimes = Layer.mergeAll(
  Layer.succeed(EditingRuntime, {
    connect: () => Effect.die("Keyboard stream must not connect editing"),
    dispatch: () => Effect.die("Keyboard stream must not dispatch editing"),
  }),
  Layer.succeed(SearchRuntime, {
    observe: () => Stream.die("Keyboard stream must not run search"),
  })
);

it.effect(
  "a key offered as a non-keyboard update arrives reaches the reducer instead of the released queue",
  () =>
    Effect.gen(function* keyboardArrivalRace() {
      const keyboard: Subscription.Subscription<
        AppModel,
        AppMessage,
        { model: AppModel },
        EditingRuntime | SearchRuntime
      > = subscriptions.keyboard;

      const base = keyboardFixture();

      const next = {
        ...base,
        calendar: { ...base.calendar, now: base.calendar.now + 60_000 },
      };

      const initial = keyboard.modelToDependencies(base);
      const changed = keyboard.modelToDependencies(next);

      const equivalent = dependencyEquivalence(keyboard);

      const latest = yield* Ref.make(initial);
      const models = yield* Queue.unbounded<AppModel>();
      const mounted = yield* Queue.unbounded<boolean>();
      const offered = yield* Deferred.make<boolean>();
      const add = window.addEventListener;

      const spy = vi
        .spyOn(window, "addEventListener")
        .mockImplementation((type, handler, options) => {
          add.call(window, type, handler, options);

          if (type === "focusin") {
            Queue.offerUnsafe(mounted, true);
          }
        });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          spy.mockRestore();
        })
      );

      const key = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "k",
        metaKey: true,
      });

      const updates = Stream.fromQueue(models).pipe(
        Stream.mapEffect((model) =>
          Effect.gen(function* modelArrival() {
            const dependencies = keyboard.modelToDependencies(model);
            yield* Ref.set(latest, dependencies);
            window.dispatchEvent(key);
            yield* Deferred.succeed(offered, true);

            return dependencies;
          })
        )
      );

      const reader = yield* Effect.forkChild(
        Stream.concat(Stream.make(initial), updates).pipe(
          Stream.changesWith(equivalent),
          Stream.switchMap((dependencies) =>
            keyboard.dependenciesToStream(dependencies, () =>
              Ref.getUnsafe(latest)
            )
          ),
          Stream.runHead
        )
      );

      yield* Queue.take(mounted);
      yield* Queue.offer(models, next);
      yield* Deferred.await(offered);
      expect(key.defaultPrevented).toBe(true);

      if (!equivalent(initial, changed)) {
        yield* Queue.take(mounted);
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            cancelable: true,
            ctrlKey: true,
            key: "f",
            metaKey: true,
          })
        );
      }

      const message = Option.getOrThrow(yield* Fiber.join(reader));
      expect(message).toMatchObject({ key: "k" });
      expect(update(next, message).model.keyboard.screen).toBe("commands");
    }).pipe(Effect.scoped, Effect.provide(unusedRuntimes))
);

it.effect.prop(
  "the retained key and focus listeners read the latest sequence and release on completion",
  { kind: Arbitrary.schema(Schema.Literals(["keydown", "focusin"])) },
  ({ kind }) =>
    Effect.gen(function* latestKeyboardModel() {
      const keyboard: Subscription.Subscription<
        AppModel,
        AppMessage,
        { model: AppModel },
        EditingRuntime | SearchRuntime
      > = subscriptions.keyboard;

      const base = keyboardFixture();
      let current = base;
      const mounted = yield* Deferred.make<boolean>();
      const add = window.addEventListener;

      const spy = vi
        .spyOn(window, "addEventListener")
        .mockImplementation((type, handler, options) => {
          add.call(window, type, handler, options);

          if (type === "focusin") {
            Deferred.doneUnsafe(mounted, Effect.succeed(true));
          }
        });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          spy.mockRestore();
        })
      );

      const reader = yield* Effect.forkChild(
        keyboard
          .dependenciesToStream(keyboard.modelToDependencies(base), () =>
            keyboard.modelToDependencies(current)
          )
          .pipe(Stream.runHead)
      );

      yield* Deferred.await(mounted);
      current = { ...base, keyboard: { ...base.keyboard, prefix: "g" } };
      window.dispatchEvent(
        kind === "keydown"
          ? new KeyboardEvent("keydown", { cancelable: true, key: "F24" })
          : new FocusEvent("focusin")
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          cancelable: true,
          ctrlKey: true,
          key: "f",
          metaKey: true,
        })
      );
      expect(Option.getOrThrow(yield* Fiber.join(reader))).toEqual(
        Message.KeyboardResetSequence()
      );
      current = base;

      const afterClose = new KeyboardEvent("keydown", {
        cancelable: true,
        ctrlKey: true,
        key: "k",
        metaKey: true,
      });

      window.dispatchEvent(afterClose);
      expect(afterClose.defaultPrevented).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(unusedRuntimes))
);
