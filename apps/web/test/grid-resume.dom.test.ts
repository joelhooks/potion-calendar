import { expect, it } from "@effect/vitest";
import { Clock, Effect, Option, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import { update, Message } from "../src/client/app.js";
import type { AppMessage } from "../src/client/app.js";
import { ScrollToNow } from "../src/client/commands.js";
import { EditorView } from "../src/client/editing/editor-model.js";
import { modelGestureHostKey } from "../src/client/editing/gesture-targets.js";
import { visibilityResumeStream } from "../src/client/grid-resume/subscription.js";
import { timeGridGeometry } from "../src/client/time-blocks/grid.js";
import { gridGeometry, initialScroll } from "../src/layout/geometry.js";
import { dayInZone } from "../src/layout/navigation.js";
import { SettingsRoute } from "../src/layout/route.js";
import { timeBlockModel } from "./time-block-fixture.js";

it.effect(
  "actual visibility subscription uses the injected clock, ignores twenty-nine minutes, resumes at thirty and removes its listener",
  () =>
    Effect.gen(function* clockedVisibility() {
      const state = yield* Effect.acquireRelease(
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

      const notices = yield* Queue.unbounded<AppMessage>();
      let delivered = 0;

      yield* Effect.scoped(
        Effect.gen(function* subscribedVisibility() {
          yield* visibilityResumeStream().pipe(
            Stream.runForEach((message) =>
              Effect.sync(() => {
                delivered += 1;
                Queue.offerUnsafe(notices, message);
              })
            ),
            Effect.forkScoped
          );
          yield* Effect.yieldNow;
          state.mockReturnValue("hidden");
          document.dispatchEvent(new Event("visibilitychange"));
          yield* TestClock.adjust(29 * 60_000);
          state.mockReturnValue("visible");
          document.dispatchEvent(new Event("visibilitychange"));
          yield* Effect.yieldNow;
          expect(delivered).toBe(0);
          state.mockReturnValue("hidden");
          document.dispatchEvent(new Event("visibilitychange"));
          yield* TestClock.adjust(30 * 60_000);
          state.mockReturnValue("visible");
          document.dispatchEvent(new Event("visibilitychange"));
          const notice = yield* Queue.take(notices);
          expect(notice).toEqual(
            Message.ResumedFromBackground({
              now: yield* Clock.currentTimeMillis,
            })
          );
          document.dispatchEvent(new Event("visibilitychange"));
          yield* Effect.yieldNow;
          expect(delivered).toBe(1);
        })
      );

      state.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      yield* TestClock.adjust(30 * 60_000);
      state.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(delivered).toBe(1);
    })
);

it.effect(
  "root resume uses fresh primary-zone time and shared compressed geometry without scrolling for clock ticks or non-today routes",
  () =>
    Effect.sync(() => {
      const model = timeBlockModel("week");
      const now = model.calendar.now + 60_000;
      const resumed = update(model, Message.ResumedFromBackground({ now }));
      expect(resumed.model.calendar.now).toBe(now);
      expect(
        resumed.commands?.filter((command) => command.name === "ScrollToNow")
      ).toHaveLength(1);
      expect(
        update(model, Message.Ticked({ now })).commands?.filter(
          (command) => command.name === "ScrollToNow"
        ) ?? []
      ).toHaveLength(0);

      for (const blocked of [
        {
          ...model,
          keyboard: { ...model.keyboard, screen: "commands" as const },
        },
        {
          ...model,
          editing: {
            ...model.editing,
            view: EditorView.cases.Loading.make({ label: "Draft" }),
          },
        },
        { ...model, route: SettingsRoute.make({ page: "general" }) },
        {
          ...model,
          calendar: {
            ...model.calendar,
            navigation: {
              ...model.calendar.navigation,
              anchor: model.calendar.navigation.anchor + 40,
            },
          },
        },
      ]) {
        expect(
          update(
            blocked,
            Message.ResumedFromBackground({ now })
          ).commands?.filter((command) => command.name === "ScrollToNow") ?? []
        ).toHaveLength(0);
      }
    })
);

it.effect(
  "resume command shares initial scroll and refuses a late native dialog, armed gesture, rectangle, stale host and hidden page",
  () =>
    Effect.gen(function* guardedResumeScroll() {
      const model = timeBlockModel("day");
      const key = Option.getOrThrow(modelGestureHostKey(model));
      const { grid, scale } = timeGridGeometry(model);
      const minute = 14 * 60;
      expect(grid.hidden.length).toBeGreaterThan(0);
      expect(initialScroll(minute, scale, 600, grid)).not.toBe(
        initialScroll(minute, scale, 600, gridGeometry(scale))
      );
      const day = dayInZone(model.calendar.now, model.calendar.zone);

      const root = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("section");
          element.id = "gesture-host";
          element.dataset.gestureHostKey = key;
          element.innerHTML = `<div id="time-viewport"><div class="day-column" data-day="${day}"></div></div>`;
          document.body.append(element);
          vi.stubGlobal(
            "requestAnimationFrame",
            (frame: FrameRequestCallback) => {
              frame(0);

              return 1;
            }
          );

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
            vi.unstubAllGlobals();
          })
      );

      const state = yield* Effect.acquireRelease(
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

      const viewport = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>("#time-viewport")
      );

      Object.defineProperty(viewport, "clientHeight", { value: 600 });

      const command = ScrollToNow({
        hidden: grid.hidden,
        minute,
        resume: { day, hostKey: key },
        scale,
      });

      yield* command.effect;
      expect(viewport.scrollTop).toBe(initialScroll(minute, scale, 600, grid));

      for (const phase of ["armed", "dragging"]) {
        for (const kind of ["gesturePhase", "selectionPhase"] as const) {
          viewport.scrollTop = 7;
          root.dataset[kind] = phase;
          yield* command.effect;
          expect(viewport.scrollTop).toBe(7);
          root.removeAttribute(
            kind === "gesturePhase"
              ? "data-gesture-phase"
              : "data-selection-phase"
          );
        }
      }

      const dialog = document.createElement("dialog");
      dialog.setAttribute("open", "");
      root.append(dialog);
      viewport.scrollTop = 7;
      yield* command.effect;
      expect(viewport.scrollTop).toBe(7);
      dialog.remove();
      root.dataset.gestureHostKey = "stale";
      yield* command.effect;
      expect(viewport.scrollTop).toBe(7);
      root.dataset.gestureHostKey = key;

      const column = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".day-column")
      );

      column.dataset.day = String(day + 1);
      yield* command.effect;
      expect(viewport.scrollTop).toBe(7);
      column.dataset.day = String(day);
      const editor = document.createElement("dialog");
      editor.dataset.editingDialog = "true";
      root.append(editor);
      yield* command.effect;
      expect(viewport.scrollTop).toBe(7);
      editor.remove();
      state.mockReturnValue("hidden");
      yield* command.effect;
      expect(viewport.scrollTop).toBe(7);
    })
);
