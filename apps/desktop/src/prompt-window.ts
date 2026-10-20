import { fileURLToPath } from "node:url";

import { promptChannels, promptWire } from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  PromptAction,
  PromptView,
} from "@calendar/core/desktop-bridge";
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";
import { BrowserWindow, ipcMain, screen, session } from "electron";

import { DesktopError } from "./config.js";

export const makePromptWindow = Effect.fn("Desktop.makePromptWindow")(
  function* makePromptWindow(
    onAction: (
      action: typeof PromptAction.Type,
      event: AgendaEventValue
    ) => void,
    onClosed: () => void
  ) {
    const context = yield* Effect.context();
    const runSync = Effect.runSyncWith(context);

    const current = yield* Ref.make<Option.Option<BrowserWindow>>(
      Option.none()
    );

    const view = yield* Ref.make<typeof PromptView.Type>({
      events: [],
      revision: 0,
    });

    const pageUrl = new URL("prompt.html", import.meta.url);
    const partition = session.fromPartition("potion-prompt");

    partition.setPermissionRequestHandler(
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Electron requires a synchronous native permission decision.
      (_contents, _permission, callback) => {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The local prompt has no permissions.
        callback(false);
      }
    );
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Electron requires a synchronous native permission check.
    partition.setPermissionCheckHandler(() => false);
    partition.setDevicePermissionHandler(() => false);
    partition.on("will-download", (event) => {
      event.preventDefault();
    });
    partition.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Electron's native request filter must synchronously reject network access.
      (_details, callback) => {
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- This bundled local page may never connect to the network.
        callback({ cancel: true });
      }
    );

    const close = Effect.sync(() => {
      const window = runSync(Ref.get(current));
      runSync(Ref.set(current, Option.none()));
      runSync(
        Ref.update(view, (previous) => ({
          events: [],
          revision: previous.revision + 1,
        }))
      );

      if (Option.isSome(window) && !window.value.isDestroyed()) {
        window.value.destroy();
      }
    });

    const trusted = (
      event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent
    ) => {
      const window = runSync(Ref.get(current));

      return (
        Option.isSome(window) &&
        !window.value.isDestroyed() &&
        event.sender === window.value.webContents &&
        event.senderFrame === window.value.webContents.mainFrame &&
        event.senderFrame?.url === pageUrl.href
      );
    };

    ipcMain.handle(promptChannels.read, (event) => {
      if (!trusted(event)) {
        throw new Error("Denied prompt request");
      }

      const message = Schema.encodeOption(promptWire.view)(
        runSync(Ref.get(view))
      );

      if (Option.isNone(message)) {
        throw new Error("Invalid prompt content");
      }

      return message.value;
    });

    const actionListener: Parameters<typeof ipcMain.on>[1] = (event, value) => {
      if (!trusted(event)) {
        return;
      }

      const decoded = Schema.decodeUnknownOption(promptWire.action)(value);

      if (Option.isNone(decoded)) {
        runSync(Effect.logWarning("Rejected prompt action"));

        return;
      }

      const action = decoded.value;

      const meeting = runSync(Ref.get(view)).events.find(
        (item) =>
          item.key.accountId === action.key.accountId &&
          item.key.calendarId === action.key.calendarId &&
          item.key.eventId === action.key.eventId
      );

      if (meeting !== undefined) {
        onAction(action, meeting);
      }
    };

    ipcMain.on(promptChannels.action, actionListener);

    yield* Effect.addFinalizer(() =>
      close.pipe(
        Effect.andThen(
          Effect.sync(() => {
            ipcMain.removeHandler(promptChannels.read);
            ipcMain.removeListener(promptChannels.action, actionListener);
          })
        )
      )
    );

    const present = Effect.fn("Desktop.presentPrompt")(function* present(
      events: readonly AgendaEventValue[]
    ) {
      const nextView = yield* Ref.updateAndGet(view, (previous) => ({
        events,
        revision: previous.revision + 1,
      }));

      const existing = yield* Ref.get(current);

      const window =
        Option.isSome(existing) && !existing.value.isDestroyed()
          ? existing.value
          : new BrowserWindow({
              alwaysOnTop: true,
              fullscreenable: false,
              height: 140,
              maximizable: false,
              minimizable: false,
              resizable: false,
              show: false,
              skipTaskbar: true,
              title: "Upcoming meetings",
              webPreferences: {
                additionalArguments: [`--potion-prompt=${pageUrl.href}`],
                contextIsolation: true,
                nodeIntegration: false,
                preload: fileURLToPath(
                  new URL("prompt-preload.cjs", import.meta.url)
                ),
                sandbox: true,
                session: partition,
                webSecurity: true,
                webviewTag: false,
              },
              width: 380,
            });

      if (Option.isNone(existing) || existing.value !== window) {
        yield* Ref.set(current, Option.some(window));
        window.on("closed", () => {
          const latest = runSync(Ref.get(current));

          if (Option.isSome(latest) && latest.value === window) {
            runSync(Ref.set(current, Option.none()));
            onClosed();
          }
        });
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event) => {
          event.preventDefault();
        });
        window.webContents.on("will-redirect", (event) => {
          event.preventDefault();
        });
        window.webContents.on("will-attach-webview", (event) => {
          event.preventDefault();
        });
      }

      if (
        window.webContents.getURL() !== pageUrl.href ||
        window.webContents.isLoadingMainFrame()
      ) {
        yield* Effect.tryPromise({
          catch: (cause) =>
            new DesktopError({
              cause,
              message: "Meeting prompt could not load",
            }),
          // @effect-diagnostics-next-line asyncFunction:off -- Electron's load options are not an Effect AbortSignal.
          try: async () => {
            await window.loadFile(fileURLToPath(pageUrl));
          },
        });
      }

      yield* Effect.try({
        catch: (cause) =>
          new DesktopError({
            cause,
            message: "Meeting prompt could not appear",
          }),
        try: () => {
          if (window.isDestroyed()) {
            return;
          }

          const area = screen.getDisplayMatching(window.getBounds()).workArea;
          window.setSize(380, Math.min(area.height, 70 + events.length * 100));
          const message = Schema.encodeOption(promptWire.view)(nextView);

          if (Option.isSome(message)) {
            window.webContents.send(promptChannels.view, message.value);
          }

          if (!window.isVisible()) {
            window.showInactive();
          }
        },
      });
    });

    return {
      active: Ref.get(current).pipe(
        Effect.map(
          (value) =>
            Option.isSome(value) &&
            !value.value.isDestroyed() &&
            value.value.isVisible()
        )
      ),
      close,
      present,
    };
  }
);

export class PromptWindow extends Context.Service<
  PromptWindow,
  Effect.Success<ReturnType<typeof makePromptWindow>>
>()("@calendar/desktop/PromptWindow") {
  static readonly layer = (
    onAction: (
      action: typeof PromptAction.Type,
      event: AgendaEventValue
    ) => void,
    onClosed: () => void
  ) => Layer.effect(PromptWindow, makePromptWindow(onAction, onClosed));
}
