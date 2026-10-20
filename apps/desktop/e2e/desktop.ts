// @effect-diagnostics-next-line nodeBuiltinImport:off -- This Mac-only proof creates an isolated Electron profile and never reads the installed profile.
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  DesktopSettings,
  DesktopStartupTiming,
} from "@calendar/core/desktop-bridge";
import { Schema } from "effect";
import electronBinary from "electron";
import { _electron, request } from "playwright-core";

import { proveCommandDialog } from "./command.ts";
import { proveHostedPublication } from "./hosted.ts";
import { proveRendererBoundary } from "./privacy.ts";
import { proveNativePrompt } from "./prompt.ts";
import { captureDesktopState } from "./state-capture.ts";
import type { DesktopStateCapture } from "./state-capture.ts";

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

// @effect-diagnostics-next-line asyncFunction:off -- The bounded native proof starts only outside resolve-only mode and always disposes its owned profile runtime.
const run = async () => {
  if (process.platform !== "darwin") {
    throw new Error(
      "Run the sandboxed desktop proof on macOS. No sandbox bypass is supported."
    );
  }

  const origin = process.argv
    .find((argument) => argument.startsWith("--origin="))
    ?.slice("--origin=".length);

  if (origin === undefined) {
    throw new Error("Pass --origin=<local fake Google dev server origin>");
  }

  const local = new URL(origin);

  if (
    local.origin !== origin ||
    !["http:", "https:"].includes(local.protocol) ||
    !(
      local.hostname === "localhost" ||
      local.hostname === "127.0.0.1" ||
      local.hostname === "[::1]" ||
      local.hostname.endsWith(".localhost")
    )
  ) {
    throw new Error(
      "The desktop proof accepts only a local fake-provider origin"
    );
  }

  const profile = await mkdtemp(
    fileURLToPath(new URL("../.e2e-user-data-", import.meta.url))
  );

  const application = await _electron.launch({
    args: [
      fileURLToPath(new URL("..", import.meta.url)),
      `--origin=${origin}`,
      `--user-data-dir=${profile}`,
    ],
    executablePath: Schema.decodeUnknownSync(Schema.String)(electronBinary),
  });

  const browser = await request.newContext();

  // @effect-diagnostics-next-line asyncFunction:off -- Playwright exposes cross-process evaluation as a native Promise.
  const captureExternal = async (startSignIn: boolean) =>
    await application.evaluate(
      // @effect-diagnostics-next-line asyncFunction:off -- Playwright serializes this native Electron callback into the main process; it cannot close over the test runtime.
      async ({ shell, Menu, app }, start) => {
        const { EventEmitter } = process.getBuiltinModule("node:events");

        const opened = EventEmitter.once(app, "desktop-proof-open", {
          signal: AbortSignal.timeout(30_000),
        });

        const original = shell.openExternal.bind(shell);

        // oxlint-disable-next-line typescript/promise-function-async -- The Electron test stub returns a resolved native Promise without opening a real browser.
        shell.openExternal = function openExternal(url) {
          shell.openExternal = original;
          app.emit("desktop-proof-open", url);

          return Promise.resolve();
        };

        if (start) {
          Menu.getApplicationMenu()?.getMenuItemById("sign-in")?.click();
        }

        const payload: readonly unknown[] = await opened;

        return String(payload[0]);
      },
      startSignIn
    );

  let stateCapture: DesktopStateCapture | undefined;

  // @effect-diagnostics-next-line asyncFunction:off -- This bounded Mac proof drives Playwright's native cross-process Promises and always disposes its owned application.
  const proof = async () => {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    const startupTiming = Schema.decodeUnknownSync(DesktopStartupTiming)(
      await page.evaluate(() => window.potionDesktop?.getStartupTiming?.())
    );

    assert(
      startupTiming.coldLoadMilliseconds >= 0,
      "Desktop startup timing must use a valid window creation stamp"
    );

    const observed = Schema.decodeUnknownSync(DesktopSettings)(
      await page.evaluate(
        // @effect-diagnostics-next-line asyncFunction:off -- This serialized callback awaits the native preload's settings Promise for its observed navigation stamp.
        async () => await window.potionDesktop?.getSettings()
      )
    );

    const navigationStartedAt = observed.runtime?.navigationStartedAt;

    if (navigationStartedAt === undefined) {
      throw new Error("Desktop navigation start was not observed");
    }

    assert(
      startupTiming.preloadMilliseconds >= 0 &&
        startupTiming.preloadStartedAt >= navigationStartedAt,
      "Preload marks must follow the main-frame navigation mark"
    );
    process.stdout.write(
      `${JSON.stringify({
        ...startupTiming,
        kind: "desktop-bridge-startup",
        navigationStartedAt,
        navigationToPreloadMilliseconds:
          startupTiming.preloadStartedAt - navigationStartedAt,
        windowToNavigationMilliseconds:
          navigationStartedAt - startupTiming.windowCreatedAt,
        withinBudget: startupTiming.preloadMilliseconds <= 50,
      })}\n`
    );

    if (process.argv.includes("--startup-only")) {
      return;
    }

    stateCapture = await captureDesktopState(page);

    await page
      .getByRole("button", { name: /^(?:Sign out|Sign in with Google)$/u })
      .waitFor();
    await application.evaluate(
      // @effect-diagnostics-next-line asyncFunction:off -- The proof clears only its newly created fake-user partition so the normal dev bootstrap cannot masquerade as a successful handoff.
      async ({ session, BrowserWindow }) => {
        await session
          .fromPartition("persist:potion-calendar")
          .clearStorageData({ storages: ["cookies"] });
        BrowserWindow.getAllWindows()[0]?.reload();
      }
    );
    await page
      .getByRole("button", { exact: true, name: "Sign in with Google" })
      .waitFor();

    const signIn = await captureExternal(true);

    const begin = await browser.get(signIn, { maxRedirects: 0 });
    assert(begin.status() === 303, "Browser sign-in must start normal OAuth");
    const authorization = new URL(begin.headers().location ?? "");
    assert(
      authorization.pathname === "/__fake-google/authorize",
      "Never run this proof against live Google"
    );
    authorization.searchParams.set("email", "joel@example.test");
    const google = await browser.get(authorization.href, { maxRedirects: 0 });
    await browser.get(google.headers().location ?? "", { maxRedirects: 0 });
    const confirmation = await browser.get(signIn);
    const confirmationText = await confirmation.text();
    assert(
      confirmationText.includes("Continue to Potion Calendar"),
      "System browser must confirm the local app handoff"
    );

    const issued = await browser.post(signIn, {
      headers: { origin },
      maxRedirects: 0,
    });

    assert(
      issued.status() === 303,
      "Handoff must issue after authenticated confirmation"
    );
    const callback = issued.headers().location ?? "";
    assert(
      new URL(callback).hostname === "127.0.0.1",
      "Handoff must target loopback only"
    );
    const returned = await browser.get(callback);
    const returnedText = await returned.text();
    assert(
      returnedText.includes("Return to Potion Calendar"),
      "Loopback must acknowledge handoff"
    );
    await page.getByLabel("Time grid", { exact: true }).waitFor();
    await page.locator(".calendar-toggle").first().waitFor();
    await page.waitForLoadState("load");
    assert(
      await application.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu()?.getMenuItemById("sign-in")?.enabled ===
          true
      ),
      "Native sign-in must finish before the account-browser proof"
    );
    await proveCommandDialog(application, page, stateCapture);

    const accountBrowser = captureExternal(false);
    assert(
      await application.evaluate(
        ({ shell }) => shell.openExternal.name === "openExternal"
      ),
      "Account browser observer must be ready"
    );
    await page.evaluate((configuredOrigin) => {
      location.assign(`${configuredOrigin}/__fake-google/authorize`);
    }, origin);
    assert(
      (await accountBrowser) === `${origin}/`,
      "An existing session must open the hosted app instead of starting sign-in again"
    );
    await page
      .getByRole("heading", { exact: true, name: "Finish in your browser" })
      .waitFor();
    assert(
      await application.evaluate(
        ({ BrowserWindow }) =>
          (BrowserWindow.getAllWindows()[0]?.listenerCount("focus") ?? 0) > 0
      ),
      "Account return observer must be ready before focus"
    );

    const accountReturned = page.waitForURL(`${origin}/`, {
      waitUntil: "load",
    });

    await Promise.all([
      accountReturned,
      application.evaluate(
        // @effect-diagnostics-next-line asyncFunction:off -- The proof awaits native load completion as well as the renderer URL before leaving the browser-account flow.
        async ({ BrowserWindow }) => {
          const { EventEmitter } = process.getBuiltinModule("node:events");
          const [window] = BrowserWindow.getAllWindows();

          if (window === undefined) {
            throw new Error("Account-return main window is missing");
          }

          const loaded = EventEmitter.once(
            window.webContents,
            "did-stop-loading",
            { signal: AbortSignal.timeout(30_000) }
          );

          // oxlint-disable-next-line unicorn/prefer-event-target -- Exercise Electron's installed listener directly; Playwright cannot drive native macOS focus delivery.
          window.emit("focus");
          await loaded;
        }
      ),
    ]);
    await page.getByLabel("Time grid", { exact: true }).waitFor();
    assert(
      await application.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu()?.getMenuItemById("sign-in")?.enabled ===
          true
      ),
      "Native browser-account navigation must finish before the next proof"
    );

    const external = captureExternal(false);
    assert(
      await application.evaluate(
        ({ shell }) => shell.openExternal.name === "openExternal"
      ),
      "External opener observation must be installed before the link click"
    );

    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "https://example.test/desktop-proof";
      link.target = "_blank";
      document.body.append(link);
      link.click();
    });
    assert(
      (await external) === "https://example.test/desktop-proof",
      "External links must reach the browser boundary"
    );
    assert(
      new URL(page.url()).origin === origin,
      "External link must not navigate the app window"
    );

    await proveRendererBoundary(page);
    await proveHostedPublication(application, page, stateCapture);
    await proveNativePrompt(application, page);

    await application.evaluate(
      // @effect-diagnostics-next-line asyncFunction:off -- The proof installs a competing native menu and loads a blank renderer solely to isolate key dispatch.
      async ({ BrowserWindow, Menu, MenuItem, app }) => {
        app.setBadgeCount(0);
        const menu = Menu.getApplicationMenu();
        menu?.append(
          new MenuItem({
            label: "Desktop proof",
            submenu: [
              {
                accelerator: "Command+K",
                click: () => {
                  app.setBadgeCount(app.getBadgeCount() + 1);
                  app.emit("desktop-proof-menu");
                },
                label: "Probe",
              },
            ],
          })
        );
        Menu.setApplicationMenu(menu);
        await BrowserWindow.getAllWindows()[0]?.loadURL("about:blank");
      }
    );
    await page.waitForURL("about:blank", { waitUntil: "load" });
    await page.evaluate(() => {
      document.body.innerHTML = '<input aria-label="Native editing">';

      const element = document.documentElement;

      const handle = (event: KeyboardEvent) => {
        if (event.metaKey && event.key === "k") {
          event.preventDefault();
          element.dataset.pageHandled = "yes";
          window.removeEventListener("keydown", handle);
        }
      };

      window.addEventListener("keydown", handle);
    });
    await page.keyboard.press("Meta+k");
    assert(
      (await page.evaluate(
        () => document.documentElement.dataset.pageHandled
      )) === "yes",
      "Page must receive Command K before the competing menu"
    );
    assert(
      (await application.evaluate(({ app }) => app.getBadgeCount())) === 0,
      "Page prevention must suppress the native menu"
    );

    const input = page.getByLabel("Native editing");
    await input.fill("original");
    await input.press("Meta+a");
    await input.press("Meta+c");
    await input.press("ArrowRight");
    await input.press("Meta+v");
    assert(
      (await input.inputValue()) === "originaloriginal",
      "Native copy paste and select all must work"
    );
    await input.press("Meta+z");
    assert(
      (await input.inputValue()) === "original",
      "Native field undo must remain available"
    );
  };

  try {
    await proof();
  } finally {
    try {
      await stateCapture?.close();
    } finally {
      try {
        await browser.dispose();
      } finally {
        await application.close();
      }
    }
  }
};

if (!process.argv.includes("--resolve-only")) {
  await run();
}
