import type { PromptSize } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import {
  attachmentButton,
  attachmentMeeting,
  mountAttachmentPrompt,
} from "./prompt-attachment-fixture.js";

it.effect(
  "the actual renderer measures the expanded list and resets expansion and revision on re-presentation without an action",
  () =>
    Effect.gen(function* rendererMeasurements() {
      const frames: FrameRequestCallback[] = [];
      const sizes: (typeof PromptSize.Type)[] = [];

      const descriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "ResizeObserver"
      );

      let notify: (() => void) | undefined;

      const raf = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((frame) => {
          frames.push(frame);

          return frames.length;
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
                this.observed = false;
              }
            },
          });
        }),
        () =>
          Effect.sync(() => {
            raf.mockRestore();
            cancel.mockRestore();

            if (descriptor === undefined) {
              Reflect.deleteProperty(globalThis, "ResizeObserver");
            } else {
              Object.defineProperty(globalThis, "ResizeObserver", descriptor);
            }
          })
      );

      const event = {
        ...attachmentMeeting,
        attachments: Array.from({ length: 4 }, (_, index) => ({
          title: `Saved ${index}`,
          url: `https://files.example.test/${index}`,
        })),
      };

      const { calls, present } = yield* mountAttachmentPrompt(
        [event],
        (size) => {
          sizes.push(size);
        }
      );

      const main = document.querySelector("main");
      expect(main).not.toBeNull();

      if (main === null) {
        throw new Error("Expected rendered main");
      }

      let height = 250;

      const bounds = vi
        .spyOn(main, "getBoundingClientRect")
        .mockImplementation(() => new DOMRect(0, 0, 380, height));

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          bounds.mockRestore();
        })
      );
      expect(frames).toHaveLength(1);
      frames[0]?.(0);
      expect(sizes).toEqual([{ height: 250, revision: 1 }]);
      attachmentButton("[data-prompt-attachments-more]").click();
      height = 330;
      notify?.();
      notify?.();
      expect(frames).toHaveLength(2);
      frames[1]?.(0);
      expect(sizes.at(-1)).toEqual({ height: 330, revision: 1 });
      present({ events: [event], revision: 2 });
      height = 250;
      notify?.();
      expect(frames).toHaveLength(3);
      frames[2]?.(0);
      expect(sizes.at(-1)).toEqual({ height: 250, revision: 2 });
      expect(
        document.querySelector(
          '[data-prompt-attachments][data-expanded="true"]'
        )
      ).toBeNull();
      expect(calls).toEqual([]);
    }).pipe(Effect.scoped)
);
