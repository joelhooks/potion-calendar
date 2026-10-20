import { DesktopSettings } from "@calendar/core/desktop-bridge";
import { Schema } from "effect";
import type { Page } from "playwright-core";

// @effect-diagnostics-next-line asyncFunction:off -- The native proof observes browser permissions and real frames through Playwright without requesting device access.
export const proveRendererBoundary = async (page: Page) => {
  const settings = Schema.decodeUnknownSync(DesktopSettings)(
    await page.evaluate(
      // @effect-diagnostics-next-line asyncFunction:off -- This serialized browser callback awaits the guarded native settings reply.
      async () => await window.potionDesktop?.getSettings()
    )
  );

  if (settings.runtime?.tray !== true) {
    throw new Error("The owned menu-bar tray must exist after bootstrap");
  }

  const denied = await page.evaluate(
    // @effect-diagnostics-next-line asyncFunction:off -- Permission queries do not request geolocation or activate camera hardware.
    async () => {
      const camera = await navigator.permissions.query({ name: "camera" });

      const location = await navigator.permissions.query({
        name: "geolocation",
      });

      return camera.state === "denied" && location.state === "denied";
    }
  );

  if (!denied) {
    throw new Error("Non-notification permissions must remain denied");
  }

  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "desktop-proof-subframe";
    frame.src = "about:blank";
    document.body.append(frame);
  });

  try {
    const body = page.frameLocator("#desktop-proof-subframe").locator("body");
    await body.waitFor({ state: "attached" });

    const isolated = await body.evaluate(
      // oxlint-disable-next-line unicorn/prefer-module -- This negative browser proof checks that no CommonJS loader exists in a subframe.
      () => window.potionDesktop === undefined && typeof require === "undefined"
    );

    if (!isolated) {
      throw new Error("Subframes must not receive the desktop bridge or Node");
    }
  } finally {
    await page.evaluate(() => {
      document.querySelector("#desktop-proof-subframe")?.remove();
    });
  }
};
