import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Queue, Predicate, Stream } from "effect";
import { Runtime } from "foldkit";
import { vi } from "vitest";

import type { AppModel } from "../src/client/app.js";
import { Message, Model, update } from "../src/client/app.js";
import { ReadPreferences } from "../src/client/commands.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import { monthFrame, monthHostKey } from "../src/client/month/host.js";
import { MonthNotice } from "../src/client/month/model.js";
import { MonthRuntime } from "../src/client/month/runtime.js";
import { monthViewRegistry } from "../src/client/month/view-state.js";
import { monthViewportMountFor } from "../src/client/month/viewport.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { SearchRuntime } from "../src/client/search/runtime.js";
import { subscriptions } from "../src/client/subscriptions.js";
import { toolbar } from "../src/features/calendar.js";
import { monthGrid } from "../src/features/month-grid.js";
import { settingsGeneral } from "../src/features/settings-general.js";
import { monthGeometry } from "../src/layout/month.js";
import { dayFromIso } from "../src/layout/navigation.js";
import { unusedClipboardLayer } from "./clipboard-unused-fixture.js";
import { fixtureModel } from "./fixture.js";
import { unexpectedSearchClient } from "./search-fixture.js";

const visibleTop = () => {
  const viewport = document.querySelector<HTMLElement>("#month-viewport");

  if (viewport === null) {
    throw new Error("Missing actual mounted month viewport");
  }

  return (
    Number(viewport.dataset.monthFirstWeek) +
    (viewport.scrollTop / monthGeometry(700, false).rowHeight) * 7
  );
};

it.effect(
  "native Alt-T and Today drive the real month actor; a Settings checkbox persists custom hiding without disturbing Month",
  () =>
    Effect.gen(function* nativeNavigation() {
      const original = fixtureModel();

      const initial = update(
        original,
        Message.ClickedView({ days: 7, mode: "month" })
      ).model;

      let current: AppModel = initial;
      const settled = yield* Queue.unbounded<boolean>();
      const saved = yield* Queue.unbounded<boolean>();
      const container = document.createElement("div");
      container.id = "navigation-root-proof";
      document.body.append(container);
      localStorage.clear();
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
        700
      );
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
        1000
      );
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
        1000
      );
      vi.stubGlobal(
        "ResizeObserver",
        class Observer {
          active = false;
          observe() {
            this.active = true;
          }
          disconnect() {
            this.active = false;
          }
        }
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          container.remove();
          localStorage.clear();
          vi.restoreAllMocks();
          vi.unstubAllGlobals();
        })
      );
      const views = monthViewRegistry();
      const prepare = monthViewportMountFor(views);

      const program = Runtime.makeElement({
        Model,
        container,
        devTools: false,
        init: () => ({ model: initial }),
        resources: Layer.mergeAll(
          MonthRuntime.layerFor(views),
          unusedClipboardLayer,
          Layer.succeed(CalendarSearchClient, unexpectedSearchClient),
          Layer.succeed(SearchRuntime, {
            dispatchPage: () => Effect.die("Navigation must not page search"),
            observe: () => Stream.die("Navigation must not search"),
            observePages: () =>
              Stream.die("Navigation must not start search pages"),
          }),
          Layer.succeed(
            EditingRuntime,
            EditingRuntime.of({
              connect: () => Effect.die("Unexpected editor connection"),
              dispatch: () => Effect.die("Navigation must not edit events"),
            })
          )
        ),
        subscriptions: {
          keyboard: subscriptions.keyboard,
          month: subscriptions.month,
        },
        update: (model, message) => {
          const result = update(model, message);
          current = result.model;

          if (
            Predicate.isTagged(message, "ReceivedMonth") &&
            MonthNotice.guards.Settled(message.notice) &&
            Option.contains(
              monthHostKey(current),
              message.notice.session.hostKey
            )
          ) {
            Queue.offerUnsafe(settled, true);
          }

          if (Predicate.isTagged(message, "SavedPreferences")) {
            Queue.offerUnsafe(saved, true);
          }

          return {
            ...result,
            commands: (result.commands ?? []).filter(
              (command) => command.name === "SavePreferences"
            ),
          };
        },
        view: (model, h) =>
          h.div(
            [],
            [
              toolbar(model, h),
              monthGrid(model, h, monthFrame(model), prepare),
              ...settingsGeneral(model, h),
            ]
          ),
      });

      yield* Effect.acquireRelease(
        Effect.sync(() => Runtime.embed(program)),
        (handle) =>
          Effect.sync(() => {
            handle.dispose();
          })
      );
      yield* Queue.take(settled);

      expect(visibleTop()).toBe(dayFromIso("2026-09-27"));
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          altKey: true,
          bubbles: true,
          cancelable: true,
          key: "t",
        })
      );
      yield* Queue.take(settled);
      expect(current.calendar.navigation.mode).toBe("month");
      expect(visibleTop()).toBe(dayFromIso("2026-10-18"));

      const today = document.querySelector<HTMLButtonElement>(
        '.toolbar button[title="Today (T)"]'
      );

      expect(today).not.toBeNull();
      today?.click();
      yield* Queue.take(settled);
      expect(visibleTop()).toBe(dayFromIso("2026-09-27"));
      const host = monthHostKey(current);

      const tuesday = document.querySelector<HTMLInputElement>(
        '[aria-label="Show Tuesday"]'
      );

      expect(tuesday).not.toBeNull();
      tuesday?.click();
      yield* Queue.take(saved);
      expect(monthHostKey(current)).toEqual(host);
      expect(visibleTop()).toBe(dayFromIso("2026-09-27"));

      const restored = update(
        original,
        yield* ReadPreferences({ person: Option.getOrThrow(current.person) })
          .effect
      ).model;

      expect(restored.calendar.navigation.hiddenWeekdays).toEqual([2]);
      expect(restored.calendar.navigation.hideWeekends).toBe(false);
    })
);
