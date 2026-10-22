import { expect, it } from "@effect/vitest";
import { Effect, Option, Predicate, Queue, Stream } from "effect";
import { Mount } from "foldkit";
import { vi } from "vitest";

import type { AppMessage } from "../src/client/app.js";
import { gestureMountFor } from "../src/client/editing/gesture-mount.js";
import { gestureTargetRegistry } from "../src/client/editing/gesture-targets.js";
import { canResumeHost } from "../src/client/grid-resume/host.js";

it.effect(
  "actual gesture mount blocks resume while armed without a preview and releases its phase projection",
  () =>
    Effect.gen(function* mountedGestureOwnership() {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("section");
          element.id = "gesture-host";
          element.dataset.gestureHostKey = "resume-fixture";
          element.innerHTML =
            '<div id="time-viewport"><div class="day-column" data-day="0"></div></div>';
          document.body.append(element);

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
          })
      );

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi
            .spyOn(document, "visibilityState", "get")
            .mockReturnValue("visible")
        ),
        (mock) =>
          Effect.sync(() => {
            mock.mockRestore();
          })
      );

      const column = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".day-column")
      );

      column.getBoundingClientRect = () => new DOMRect(0, 0, 200, 1152);
      const resume = { day: 0, hostKey: "resume-fixture" };
      const registry = gestureTargetRegistry();
      const messages = yield* Queue.unbounded<AppMessage>();

      const phase = (expected: "armed" | "dragging" | "idle") =>
        Stream.fromQueue(messages).pipe(
          Stream.filter(
            (message) =>
              Predicate.isTagged(message, "PreviewedGesture") &&
              message.phase === expected
          ),
          Stream.runHead
        );

      const point = (type: string, y: number) => {
        (type === "pointerdown" ? column : window).dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            clientX: 100,
            clientY: y,
            isPrimary: true,
            pointerId: 83,
          })
        );
      };

      yield* Effect.scoped(
        Effect.gen(function* gestureLifetime() {
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              registry.register(resume.hostKey, root, () => [])
            ),
            (release) => Effect.sync(release)
          );
          yield* gestureMountFor(registry)({
            hostKey: resume.hostKey,
            personId: "test-person",
            scale: 48,
          })
            .f(root, Mount.liveViewStateChanges)
            .pipe(
              Stream.runForEach((message) => Queue.offer(messages, message)),
              Effect.forkScoped
            );
          yield* Stream.fromQueue(messages).pipe(
            Stream.filter((message) =>
              Predicate.isTagged(message, "PreparedGestureHost")
            ),
            Stream.runHead
          );
          expect(canResumeHost(document, resume)).toBe(true);
          point("pointerdown", 400);
          const armed = yield* phase("armed");
          expect(armed).toMatchObject({ value: { phase: "armed" } });
          expect(Option.getOrThrow(armed)).toMatchObject({
            preview: Option.none(),
          });
          expect(root.dataset.gesturePhase).toBe("armed");
          expect(canResumeHost(document, resume)).toBe(false);
          point("pointermove", 440);
          yield* phase("dragging");
          expect(root.dataset.gesturePhase).toBe("dragging");
          expect(canResumeHost(document, resume)).toBe(false);
          point("pointerup", 440);
          yield* phase("idle");
          expect(canResumeHost(document, resume)).toBe(true);
        })
      );
      expect(Object.hasOwn(root.dataset, "gesturePhase")).toBe(false);
      expect(registry.count()).toBe(0);
    })
);
