// @effect-diagnostics-next-line nodeBuiltinImport:off -- This Mac-only proof creates an isolated Electron profile and never reads the installed profile.
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";
import electronBinary from "electron";
import { _electron, request } from "playwright-core";

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

const assert = (condition: boolean, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

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

try {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
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
  await page.keyboard.press("Meta+k");
  const command = page.getByRole("dialog");

  if ((await command.count()) === 0) {
    await page.keyboard.press("c");
  }

  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");

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
  await application.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    // oxlint-disable-next-line unicorn/prefer-event-target -- Exercise Electron's installed listener directly; Playwright cannot drive native macOS focus delivery.
    window?.emit("focus");
  });
  await page.getByLabel("Time grid", { exact: true }).waitFor();

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
} finally {
  await browser.dispose();
  await application.close();
}
