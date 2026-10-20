// @effect-diagnostics-next-line nodeBuiltinImport:off -- Electron main persists only window geometry in its private user-data directory.
import { readFileSync, writeFileSync } from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Electron requires an absolute sandboxed preload path.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  screen,
  session,
  shell,
} from "electron";

import { authNavigation } from "./auth-navigation.js";
import { runBrowserAccount } from "./browser-account-machine.js";
import { DesktopError, desktopOrigin } from "./config.js";
import { waitForSignIn } from "./loopback.js";
import { applicationMenu } from "./menus.js";
import { navigation, startsSystemSignIn } from "./navigation.js";
import { runSignIn } from "./sign-in-machine.js";
import { startMain } from "./startup.js";
import { clampWindow, WindowBounds } from "./window-state.js";

const loadWindow = (window: BrowserWindow, url: string) =>
  Effect.tryPromise({
    catch: (cause) =>
      new DesktopError({ cause, message: "Calendar could not load" }),
    // @effect-diagnostics-next-line asyncFunction:off -- Electron's optional load options are not an Effect AbortSignal.
    try: async () => {
      await window.loadURL(url);
    },
  });

// @effect-diagnostics-next-line asyncFunction:off -- The main process adapts Electron's browser opener without exposing it to the page.
const openBrowser = async (url: string) => {
  await shell.openExternal(url);
};

const startDesktop = Effect.fn("Desktop.start")(function* startDesktop() {
  const context = yield* Effect.context();
  const runSync = Effect.runSyncWith(context);
  const runFork = Effect.runForkWith(context);

  const originArgument = process.argv
    .find((argument) => argument.startsWith("--origin="))
    ?.slice("--origin=".length);

  const origin = yield* desktopOrigin(app.isPackaged, originArgument);
  const partition = session.fromPartition("persist:potion-calendar");

  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Electron requires a native permission decision callback.
  partition.setPermissionRequestHandler((_contents, _permission, callback) => {
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Electron permission decisions require a synchronous callback.
    callback(false);
  });
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Electron permission checks are synchronous native callbacks.
  partition.setPermissionCheckHandler(() => false);
  partition.setDevicePermissionHandler(() => false);
  partition.on("will-download", (event) => {
    event.preventDefault();
  });

  const savedPath = path.join(app.getPath("userData"), "window.json");

  const saved = yield* Effect.try({
    catch: (cause) =>
      new DesktopError({ cause, message: "No saved window geometry" }),
    try: () => readFileSync(savedPath, "utf-8"),
  }).pipe(
    Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(WindowBounds))),
    Effect.orElseSucceed(() => ({ height: 850, width: 1280, x: 100, y: 100 }))
  );

  const bounds = clampWindow(
    saved,
    screen.getAllDisplays().map((display) => display.workArea)
  );

  const window = new BrowserWindow({
    ...bounds,
    show: false,
    title: "Potion Calendar",
    webPreferences: {
      contextIsolation: true,
      navigateOnDragDrop: false,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("preload.cjs", import.meta.url)),
      sandbox: true,
      session: partition,
      webSecurity: true,
      webviewTag: false,
    },
  });

  const focus = () => {
    if (window.isMinimized()) {
      window.restore();
    }

    window.show();
    window.focus();
  };

  const signInRequests = new EventTarget();

  const handleNavigation = (target: string) => {
    if (startsSystemSignIn(target, origin, app.isPackaged)) {
      signInRequests.dispatchEvent(new Event("sign-in"));

      return "deny";
    }

    const decision = navigation(target, origin);

    if (decision === "browser") {
      runFork(
        Effect.tryPromise({
          catch: (cause) =>
            new DesktopError({
              cause,
              message: "Could not open external link",
            }),
          // @effect-diagnostics-next-line asyncFunction:off -- Electron's optional browser options must not receive an Effect AbortSignal.
          try: async () => {
            await openBrowser(target);
          },
        }).pipe(
          Effect.tapError(() =>
            Effect.logWarning("Could not open external link")
          ),
          Effect.orElseSucceed(() => null)
        )
      );
    } else if (decision === "deny") {
      runSync(Effect.logWarning("Denied desktop navigation"));
    }

    return decision;
  };

  window.webContents.on("will-navigate", (event, url) => {
    if (handleNavigation(url) !== "window") {
      event.preventDefault();
    }
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame && navigation(event.url, origin) !== "window") {
      event.preventDefault();
    }
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (handleNavigation(url) !== "window") {
      event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (handleNavigation(url) === "window") {
      runFork(
        loadWindow(window, url).pipe(
          Effect.tapError(() =>
            Effect.logWarning("Could not open calendar link")
          ),
          Effect.orElseSucceed(() => null)
        )
      );
    }

    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  const save = () => {
    if (window.isMaximized() || window.isFullScreen()) {
      return;
    }

    runSync(
      Effect.try({
        catch: (cause) =>
          new DesktopError({
            cause,
            message: "Could not save window geometry",
          }),
        try: () => {
          writeFileSync(savedPath, JSON.stringify(window.getBounds()), {
            mode: 0o600,
          });
        },
      }).pipe(
        Effect.tapError(() =>
          Effect.logWarning("Could not save window geometry")
        ),
        Effect.orElseSucceed(() => null)
      )
    );
  };

  window.on("resized", save);
  window.on("moved", save);

  const hide = (event: Electron.Event) => {
    event.preventDefault();
    window.hide();
  };

  if (process.platform === "darwin") {
    window.on("close", hide);
    app.once("before-quit", () => {
      window.removeListener("close", hide);
    });
  }

  app.on("second-instance", focus);
  app.on("activate", focus);
  window.once("ready-to-show", focus);

  const launchFlow = (work: Effect.Effect<void>) => {
    const controller = new AbortController();

    const cancel = () => {
      controller.abort();
    };

    app.once("before-quit", cancel);
    runFork(
      work.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            app.removeListener("before-quit", cancel);
          })
        )
      ),
      { signal: controller.signal }
    );
  };

  const startSignIn = () => {
    const item = Menu.getApplicationMenu()?.getMenuItemById("sign-in");

    if (item === undefined || item === null || !item.enabled) {
      return;
    }

    item.enabled = false;

    const work = runSignIn({
      redeem: (token) => {
        const complete = new URL("/desktop/complete", origin);
        complete.searchParams.set("token", token);

        return loadWindow(window, complete.href).pipe(
          Effect.flatMap(() =>
            window.webContents.getURL() === `${origin}/`
              ? Effect.void
              : Effect.fail(
                  new DesktopError({ message: "Desktop sign-in refused" })
                )
          )
        );
      },
      wait: waitForSignIn(origin, openBrowser),
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          item.enabled = true;
        })
      ),
      Effect.flatMap((result) =>
        Effect.gen(function* showSignInResult() {
          focus();

          if (result === "signedIn") {
            return;
          }

          const answer = yield* Effect.tryPromise({
            catch: (cause) =>
              new DesktopError({
                cause,
                message: "Could not show sign-in message",
              }),
            // @effect-diagnostics-next-line asyncFunction:off -- Electron's overloaded message box API is a native Promise adapter.
            try: async () =>
              await dialog.showMessageBox(window, {
                buttons: ["Try again", "Cancel"],
                cancelId: 1,
                detail: "Sign in again using your browser.",
                message:
                  result === "timedOut" ? "Sign-in expired" : "Sign-in failed",
                type: "error",
              }),
          });

          if (answer.response === 0) {
            startSignIn();
          }
        })
      ),
      Effect.tapError(() => Effect.logError("Desktop sign-in unavailable")),
      Effect.orElseSucceed(() => null)
    );

    launchFlow(work.pipe(Effect.asVoid));
  };

  const startBrowserAccount = () => {
    const item = Menu.getApplicationMenu()?.getMenuItemById("sign-in");

    if (item === null || item === undefined || !item.enabled) {
      return;
    }

    item.enabled = false;

    const open = loadWindow(window, `${origin}/desktop/browser-account`).pipe(
      Effect.flatMap(() =>
        Effect.tryPromise({
          catch: (cause) =>
            new DesktopError({
              cause,
              message: "Could not open account settings in the browser",
            }),
          // @effect-diagnostics-next-line asyncFunction:off -- Electron's system browser opener is a native Promise boundary.
          try: async () => {
            await openBrowser(`${origin}/`);
          },
        })
      )
    );

    const wait = Effect.callback<"focused">((resume) => {
      const returned = () => {
        resume(Effect.succeed("focused"));
      };

      window.once("focus", returned);

      return Effect.sync(() => {
        window.removeListener("focus", returned);
      });
    }).pipe(Effect.asVoid);

    const work = runBrowserAccount({
      open,
      reload: loadWindow(window, `${origin}/`),
      wait,
    }).pipe(
      Effect.flatMap((result) =>
        result === "returned"
          ? Effect.void
          : Effect.logWarning("Browser account flow did not complete")
      ),
      Effect.ensuring(
        Effect.sync(() => {
          item.enabled = true;
        })
      )
    );

    launchFlow(work);
  };

  signInRequests.addEventListener("sign-in", () => {
    runFork(
      Effect.tryPromise({
        catch: (cause) =>
          new DesktopError({ cause, message: "Desktop session check failed" }),
        // @effect-diagnostics-next-line asyncFunction:off -- Electron owns the partition cookie jar; only cookie names guide the native handoff choice.
        try: async () => await partition.cookies.get({ url: origin }),
      }).pipe(
        Effect.map((cookies) =>
          authNavigation(cookies.map((cookie) => cookie.name))
        ),
        Effect.tap((decision) =>
          Effect.sync(() => {
            if (decision === "signIn") {
              startSignIn();
            } else {
              startBrowserAccount();
            }
          })
        ),
        Effect.tapError(() =>
          Effect.logWarning("Desktop session check failed")
        ),
        Effect.orElseSucceed(() => null)
      )
    );
  });
  Menu.setApplicationMenu(applicationMenu(startSignIn));
  yield* loadWindow(window, origin);
});

if (app.requestSingleInstanceLock()) {
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  startMain(
    Effect.promise(app.whenReady.bind(app)).pipe(
      Effect.flatMap(startDesktop),
      // oxlint-disable-next-line promise/prefer-await-to-then -- This is Effect error handling; awaiting Electron readiness at module scope blocks Playwright's launch handshake.
      Effect.catch(() =>
        Effect.sync(() => {
          dialog.showErrorBox(
            "Potion Calendar",
            "Calendar could not open. Check the connection and try again."
          );
          app.quit();
        })
      )
    )
  );
} else {
  app.quit();
}
