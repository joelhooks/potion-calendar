import { promptActionMenuPaddingPx } from "@calendar/core/desktop-bridge";
import type { PromptBridge, PromptSize } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import { createPromptMeasurement } from "../src/client/prompt-measurement.js";
import {
  attachmentButton,
  attachmentMeeting,
  mountAttachmentPrompt,
} from "./prompt-attachment-fixture.js";

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
      measured.menu(true);
      measured.menu(true);
      expect(callbacks).toHaveLength(3);
      callbacks[2]?.(0);
      expect(reports.at(-1)).toEqual({
        height: 420,
        menuPadding: 160,
        revision: 2,
      });
      measured.menu(false);
      callbacks[3]?.(0);
      expect(reports.at(-1)).toEqual({ height: 420, revision: 2 });
      measured.menu(true);
      measured.presented(3);
      callbacks[4]?.(0);
      expect(reports.at(-1)).toEqual({ height: 420, revision: 3 });
      notify?.();
      measured.dispose();
      expect(cancel).toHaveBeenCalledWith(6);
      expect(disconnected).toBe(true);
    }).pipe(Effect.scoped)
);

it.effect(
  "the actual renderer requests menu allowance and restores it on Escape, toggle, action and new content without resize focus loss",
  () =>
    Effect.gen(function* actualMenuHistory() {
      const frames: FrameRequestCallback[] = [];

      const reports: (typeof PromptSize.Type)[] = [];

      const raf = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((receive) => {
          frames.push(receive);

          return frames.length;
        });

      const cancel = vi
        .spyOn(window, "cancelAnimationFrame")
        .mockImplementation(() => {});

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          raf.mockRestore();
          cancel.mockRestore();
        })
      );

      const { calls, present } = yield* mountAttachmentPrompt(
        [attachmentMeeting],
        (report) => {
          reports.push(report);
        }
      );

      const main = document.querySelector("main");

      const menu = document.querySelector<HTMLElement>('[role="menu"]');
      expect(main).not.toBeNull();
      expect(menu).not.toBeNull();

      if (main === null || menu === null) {
        return yield* Effect.die(
          new Error("Expected actual prompt menu recipient")
        );
      }

      const rootBounds = vi
        .spyOn(main, "getBoundingClientRect")
        .mockImplementation(() => new DOMRect(0, 0, 380, 170));

      const menuBounds = vi
        .spyOn(menu, "getBoundingClientRect")
        .mockImplementation(() => new DOMRect(0, 0, 158, 91));

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          rootBounds.mockRestore();
          menuBounds.mockRestore();
        })
      );

      const flush = () => {
        frames.at(-1)?.(0);
      };

      flush();
      attachmentButton("[data-prompt-menu]").click();
      flush();
      expect(reports.at(-1)).toEqual({
        height: 170,
        menuPadding: 160,
        revision: 1,
      });
      expect(promptActionMenuPaddingPx).toBeGreaterThanOrEqual(
        4 + menu.getBoundingClientRect().height + 8
      );
      const focused = document.activeElement;
      window.dispatchEvent(new Event("resize"));
      expect(document.activeElement).toBe(focused);
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
      );
      flush();
      expect(reports.at(-1)).toEqual({ height: 170, revision: 1 });
      expect(document.activeElement).toBe(
        attachmentButton("[data-prompt-menu]")
      );
      attachmentButton("[data-prompt-menu]").click();
      flush();
      attachmentButton("[data-prompt-menu]").click();
      flush();
      expect(reports.at(-1)).toEqual({ height: 170, revision: 1 });
      attachmentButton("[data-prompt-menu]").click();
      attachmentButton('[data-prompt-item="show"]').click();
      flush();
      expect(reports.at(-1)).toEqual({ height: 170, revision: 1 });
      expect(calls).toHaveLength(1);
      attachmentButton("[data-prompt-menu]").click();
      present({ events: [attachmentMeeting], revision: 2 });
      flush();
      expect(reports.at(-1)?.menuPadding).toBeUndefined();
      expect(reports.at(-1)?.revision).toBe(2);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);
