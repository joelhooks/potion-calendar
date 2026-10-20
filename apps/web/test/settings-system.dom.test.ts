import { expect, it } from "@effect/vitest";
import { Effect, Queue, Stream } from "effect";
import { vi } from "vitest";

import { update } from "../src/client/app.js";
import { resolvedTheme } from "../src/client/settings/model.js";
import { systemSettingsStream } from "../src/client/settings/system.js";
import { fixtureModel } from "./fixture.js";

it.effect(
  "Auto theme follows media changes and its scoped subscription removes the listener",
  () =>
    Effect.gen(function* systemMediaLifecycle() {
      const target = new EventTarget();
      let dark = false;

      const add = vi.fn((type: string, listener: EventListener) => {
        target.addEventListener(type, listener);
      });

      const remove = vi.fn((type: string, listener: EventListener) => {
        target.removeEventListener(type, listener);
      });

      const media = {
        addEventListener: add,
        get matches() {
          return dark;
        },
        removeEventListener: remove,
      };

      const previous = Object.getOwnPropertyDescriptor(window, "matchMedia");
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          Object.defineProperty(window, "matchMedia", {
            configurable: true,
            value: vi.fn(() => media),
          });
        }),
        () =>
          Effect.sync(() => {
            if (previous === undefined) {
              Reflect.deleteProperty(window, "matchMedia");
            } else {
              Object.defineProperty(window, "matchMedia", previous);
            }
          })
      );
      yield* Effect.scoped(
        Effect.gen(function* observeMedia() {
          const messages = yield* systemSettingsStream().pipe(
            Stream.toQueue({ capacity: "unbounded" })
          );

          const first = yield* Queue.take(messages);
          expect(first._tag).toBe("ReceivedSystemSettings");
          expect(resolvedTheme(update(fixtureModel(), first).model)).toBe(
            "light"
          );
          dark = true;
          target.dispatchEvent(new Event("change"));
          const changed = yield* Queue.take(messages);
          expect(resolvedTheme(update(fixtureModel(), changed).model)).toBe(
            "dark"
          );
          expect(add).toHaveBeenCalledTimes(1);
        })
      );
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove.mock.calls[0]?.[1]).toBe(add.mock.calls[0]?.[1]);
    })
);
