import type { PromptBridge, PromptSize } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import { createPromptMeasurement } from "../src/client/prompt-measurement.js";

it.effect(
  "content reports coalesce observer bursts, follow the current revision, and cancel on page disposal",
  () =>
    Effect.gen(function* contentMeasurements() {
      const callbacks: FrameRequestCallback[] = [];
      const reports: (typeof PromptSize.Type)[] = [];

      const descriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "ResizeObserver"
      );

      let notify: (() => void) | undefined;
      let disconnected = false;
      let height = 170;
      const main = document.createElement("main");

      const bounds = vi
        .spyOn(main, "getBoundingClientRect")
        .mockImplementation(() => new DOMRect(0, 0, 380, height));

      const raf = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((frame) => {
          callbacks.push(frame);

          return callbacks.length;
        });

      const cancel = vi
        .spyOn(window, "cancelAnimationFrame")
        .mockImplementation(() => {});

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          Object.defineProperty(globalThis, "ResizeObserver", {
            configurable: true,
            value: class {
              observed = false;
              constructor(receive: () => void) {
                notify = receive;
              }
              observe() {
                this.observed = true;
              }
              disconnect() {
                disconnected = this.observed;
              }
            },
          });
        }),
        () =>
          Effect.sync(() => {
            if (descriptor === undefined) {
              Reflect.deleteProperty(globalThis, "ResizeObserver");
            } else {
              Object.defineProperty(globalThis, "ResizeObserver", descriptor);
            }

            bounds.mockRestore();
            raf.mockRestore();
            cancel.mockRestore();
          })
      );

      const initial = Promise.resolve({ events: [], revision: 1 });

      const bridge: PromptBridge = {
        act: () => {},
        // oxlint-disable-next-line typescript/promise-function-async -- The owned preload port returns a pre-settled native Promise without creating an async Effect boundary.
        getView: () => initial,
        onView: () => () => {},
        reportSize: (size) => {
          reports.push(size);
        },
      };

      const measured = createPromptMeasurement(main, bridge);
      measured.presented(1);
      notify?.();
      notify?.();
      measured.presented(2);
      expect(callbacks).toHaveLength(1);
      callbacks[0]?.(0);
      expect(reports).toEqual([{ height: 170, revision: 2 }]);
      height = 420;
      notify?.();
      notify?.();
      expect(callbacks).toHaveLength(2);
      callbacks[1]?.(0);
      expect(reports).toEqual([
        { height: 170, revision: 2 },
        { height: 420, revision: 2 },
      ]);
      notify?.();
      measured.dispose();
      expect(cancel).toHaveBeenCalledWith(3);
      expect(disconnected).toBe(true);
    }).pipe(Effect.scoped)
);
