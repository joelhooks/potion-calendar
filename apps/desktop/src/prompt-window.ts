import { fileURLToPath } from "node:url";

import {
  PromptSoundRequest,
  promptChannels,
  promptWire,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaEventValue,
  PromptAction,
  PromptView,
  PromptSound,
  PlayablePromptSound,
} from "@calendar/core/desktop-bridge";
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect";
import { BrowserWindow, ipcMain, screen, session } from "electron";

import { DesktopError } from "./config.js";
import type { PromptPresentation } from "./prompt-machine.js";
import { previewWithSound, revealWithSound } from "./sound-machine.js";
import { preparePromptSound } from "./sound-port.js";
import type { PromptSoundPort } from "./sound-port.js";

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

    const soundRequest = yield* Ref.make(0);
    const windowLock = yield* Semaphore.make(1);

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

    const dispose = Effect.sync(() => {
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

    const close = Ref.get(view).pipe(
      Effect.flatMap((content) =>
        content.events.length === 0 ? Effect.void : dispose
      )
    );

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
      dispose.pipe(
        Effect.andThen(
          Effect.sync(() => {
            ipcMain.removeHandler(promptChannels.read);
            ipcMain.removeListener(promptChannels.action, actionListener);
          })
        )
      )
    );

    const soundPort = (window: BrowserWindow): PromptSoundPort => ({
      send: (request) => {
        const message = Schema.encodeOption(promptWire.sound)(request);

        if (!window.isDestroyed() && Option.isSome(message)) {
          window.webContents.send(promptChannels.sound, message.value);
        }
      },
      subscribe: (receive) => {
        const listener: Parameters<typeof ipcMain.on>[1] = (event, value) => {
          if (trusted(event)) {
            const message = Schema.decodeUnknownOption(Schema.String)(value);

            if (Option.isSome(message)) {
              receive(message.value);
            }
          }
        };

        ipcMain.on(promptChannels.soundReply, listener);

        return () => {
          ipcMain.removeListener(promptChannels.soundReply, listener);
        };
      },
    });

    const prepareWindow = Effect.fn("Desktop.preparePromptWindow")(
      function* prepareWindow() {
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
                  autoplayPolicy: "no-user-gesture-required",
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
              runSync(
                Ref.update(view, (previous) => ({
                  events: [],
                  revision: previous.revision + 1,
                }))
              );
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

        return window;
      },
      Semaphore.withPermit(windowLock)
    );

    const present = Effect.fn("Desktop.presentPrompt")(function* present(
      events: readonly AgendaEventValue[],
      presentation: PromptPresentation
    ) {
      const nextView = yield* Ref.updateAndGet(view, (previous) => ({
        events,
        revision: previous.revision + 1,
      }));

      const window = yield* prepareWindow();
      const port = soundPort(window);
      yield* Effect.try({
        catch: (cause) =>
          new DesktopError({
            cause,
            message: "Meeting prompt could not update",
          }),
        try: () => {
          if (!window.isDestroyed()) {
            const area = screen.getDisplayMatching(window.getBounds()).workArea;
            window.setSize(
              380,
              Math.min(area.height, 70 + events.length * 100)
            );
            const message = Schema.encodeOption(promptWire.view)(nextView);

            if (Option.isSome(message)) {
              window.webContents.send(promptChannels.view, message.value);
            }
          }
        },
      });

      if (!presentation.reveal) {
        return;
      }

      const request = yield* Ref.updateAndGet(
        soundRequest,
        (previous) => previous + 1
      );

      yield* revealWithSound(presentation.sound, {
        load: (sound) => preparePromptSound(port, request, sound),
        play: (sound) =>
          Effect.sync(() => {
            if (!window.isDestroyed()) {
              port.send(PromptSoundRequest.cases.Play.make({ request, sound }));
            }
          }),
        reveal: Effect.try({
          catch: (cause) =>
            new DesktopError({
              cause,
              message: "Meeting prompt could not appear",
            }),
          try: () => {
            if (!window.isDestroyed()) {
              window.showInactive();
            }
          },
        }),
      });
    });

    const active = Ref.get(current).pipe(
      Effect.map(
        (value) =>
          Option.isSome(value) &&
          !value.value.isDestroyed() &&
          value.value.isVisible()
      )
    );

    const preview = Effect.fn("Desktop.previewPromptSound")(function* preview(
      sound: typeof PromptSound.Type,
      enabled: Effect.Effect<boolean>
    ) {
      return yield* previewWithSound(sound, {
        active,
        enabled,
        prepare: Effect.gen(function* preparePreview() {
          const window = yield* prepareWindow();
          const port = soundPort(window);

          const request = yield* Ref.updateAndGet(
            soundRequest,
            (previous) => previous + 1
          );

          return {
            cancel: Effect.sync(() => {
              port.send(PromptSoundRequest.cases.Cancel.make({ request }));
            }),
            load: (tone: typeof PlayablePromptSound.Type) =>
              preparePromptSound(port, request, tone),
            play: (tone: typeof PlayablePromptSound.Type) =>
              Effect.sync(() => {
                if (!window.isDestroyed()) {
                  port.send(
                    PromptSoundRequest.cases.Play.make({ request, sound: tone })
                  );
                }
              }),
          };
        }),
      });
    });

    return {
      active,
      close,
      present,
      preview,
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
