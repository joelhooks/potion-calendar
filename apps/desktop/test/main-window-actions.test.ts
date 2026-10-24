import { DesktopAction } from "@calendar/core/desktop-bridge";
import type { DesktopActionValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { focusMainWindow, mainWindowActions } from "../src/main-window.js";

const windowPort = (initial: "hidden" | "minimised" | "visible") => {
  const trace: string[] = [];

  const state = {
    focused: false,
    minimised: initial === "minimised",
    visible: initial === "visible",
  };

  const window = {
    focus: () => {
      state.focused = true;
      trace.push("focus existing main");
    },
    isMinimized: () => state.minimised,
    restore: () => {
      state.minimised = false;
      trace.push("restore existing main");
    },
    show: () => {
      state.visible = true;
      trace.push("show existing main");
    },
  };

  return { state, trace, window };
};

it.effect.each(["hidden", "minimised", "visible"] as const)(
  "Show restores, shows and focuses the existing %s main-window port on every invocation",
  (initial) =>
    Effect.gen(function* repeatedShow() {
      const port = windowPort(initial);
      const pageActions: DesktopActionValue[] = [];

      const actions = mainWindowActions(
        () => {
          focusMainWindow(port.window);
        },
        (action) =>
          Effect.sync(() => {
            pageActions.push(action);
          })
      );

      yield* actions.open();
      yield* actions.open();
      expect(port.state).toEqual({
        focused: true,
        minimised: false,
        visible: true,
      });
      expect(port.trace).toEqual([
        ...(initial === "minimised" ? ["restore existing main"] : []),
        "show existing main",
        "focus existing main",
        "show existing main",
        "focus existing main",
      ]);
      expect(pageActions).toEqual([]);
    })
);

it.effect.each(["general", "menu-bar", "notifications"] as const)(
  "Settings %s from tray-only state focuses the retained window before the typed page action",
  (page) =>
    Effect.gen(function* trayOnlySettings() {
      const port = windowPort("hidden");
      const pageActions: DesktopActionValue[] = [];

      const actions = mainWindowActions(
        () => {
          focusMainWindow(port.window);
        },
        (action) =>
          Effect.sync(() => {
            expect(port.state.visible).toBe(true);
            expect(port.state.focused).toBe(true);
            port.trace.push("send requested page to retained page");
            pageActions.push(action);
          })
      );

      yield* actions.settings(page);
      expect(port.trace).toEqual([
        "show existing main",
        "focus existing main",
        "send requested page to retained page",
      ]);
      expect(pageActions).toEqual([
        DesktopAction.cases.OpenSettings.make({ page }),
      ]);
    })
);
