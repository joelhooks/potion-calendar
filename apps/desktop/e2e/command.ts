import type { BrowserWindow } from "electron";
import type { ElectronApplication, Page } from "playwright-core";

import { capturePageKeys } from "./key-capture.ts";
import type { DesktopStateCapture } from "./state-capture.ts";

// @effect-diagnostics-next-line asyncFunction:off -- The Mac proof emulates page focus through its owned CDP session without taking OS focus.
export const proveCommandDialog = async (
  application: ElectronApplication,
  page: Page,
  capture: DesktopStateCapture
) => {
  const owner = await application.browserWindow(page);
  const keys = await capturePageKeys(page);
  const focusSession = await page.context().newCDPSession(page);
  let globalCommandK: boolean | undefined;

  try {
    await focusSession.send("Emulation.setFocusEmulationEnabled", {
      enabled: true,
    });
    await page.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 5000,
    });

    const environment = await page.evaluate(() => ({
      development:
        ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
        [...document.scripts].some(
          (script) =>
            script.src.length > 0 &&
            new URL(script.src).pathname === "/@vite/client"
        ),
      documentEpoch: performance.timeOrigin,
    }));

    if (
      environment.development &&
      !capture.states.some(
        (state) => state.documentEpoch === environment.documentEpoch
      )
    ) {
      throw new Error(
        "Loopback command proof requires current-document keyboard model diagnostics"
      );
    }

    globalCommandK = await application.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered("Command+K")
    );

    if (globalCommandK) {
      throw new Error(
        "The owned profile has a native global Command+K registration before the page command proof"
      );
    }

    const command = page.locator("#keyboard-command-dialog");
    await page.keyboard.press("Meta+k");
    await command.waitFor({ state: "visible", timeout: 10_000 });
    await page.keyboard.press("Escape");
    await command.waitFor({ state: "hidden", timeout: 5000 });
  } catch (error) {
    const nativeFocused = await owner.evaluate(
      (window: BrowserWindow) => !window.isDestroyed() && window.isFocused()
    );

    const focus = await page.evaluate(() => ({
      activeRole: document.activeElement?.getAttribute("role") ?? null,
      activeTag: document.activeElement?.tagName ?? null,
      dialogs: [
        ...document.querySelectorAll("dialog[open], [role='dialog']"),
      ].filter((dialog) => dialog.checkVisibility()).length,
      pageFocused: document.hasFocus(),
    }));

    process.stderr.write(
      `${JSON.stringify({ ...focus, globalCommandK, keyboardStates: capture.states.map(({ documentEpoch, keyboardPrefix, keyboardScreen, routeTag, timestamp, trigger }) => ({ documentEpoch, keyboardPrefix, keyboardScreen, routeTag, timestamp, trigger })), keydowns: keys.records, kind: "desktop-command-focus-failure", nativeFocused })}\n`
    );
    throw error;
  } finally {
    try {
      await focusSession.send("Emulation.setFocusEmulationEnabled", {
        enabled: false,
      });
    } finally {
      try {
        await focusSession.detach();
      } finally {
        try {
          await keys.close();
        } finally {
          await owner.dispose();
        }
      }
    }
  }
};
