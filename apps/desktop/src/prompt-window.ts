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
import {
  BrowserWindow,
  ipcMain as electronIpcMain,
  screen as electronScreen,
  session,
} from "electron";

import { DesktopError } from "./config.js";
import type { PromptPresentation } from "./prompt-machine.js";
import { resizePromptWindow, revealPromptWindow } from "./prompt-placement.js";
import { nextPromptView } from "./prompt-preferences.js";
import { promptFallbackHeight, promptMeasuredHeight } from "./prompt-size.js";
import {
  promptDismissalIntervalMs,
  startPromptWindowLifecycle,
} from "./prompt-window-lifecycle.js";
import { previewWithSound, revealWithSound } from "./sound-machine.js";
import { preparePromptSound } from "./sound-port.js";
import type { PromptSoundPort } from "./sound-port.js";

type PromptNavigationListener = (event: { preventDefault: () => void }) => void;

interface PromptNativeFrame {
  readonly url: string;
}

interface PromptIpcEvent {
  readonly sender: PromptNativeContents;
  readonly senderFrame: PromptNativeFrame | null;
}

type PromptIpcListener = (
  event: PromptIpcEvent,
  value: Parameters<Parameters<typeof electronIpcMain.on>[1]>[1]
) => void;

interface PromptNativeContents {
  readonly getURL: () => string;
  readonly isLoadingMainFrame: () => boolean;
  readonly mainFrame: PromptNativeFrame;
  readonly send: (channel: string, value: string) => void;
  readonly setWindowOpenHandler: (
    handler: () => { readonly action: "deny" }
  ) => void;
  readonly on: ((
    name: "will-navigate",
    receive: PromptNavigationListener
  ) => void) &
    ((name: "will-redirect", receive: PromptNavigationListener) => void) &
    ((name: "will-attach-webview", receive: PromptNavigationListener) => void);
}

export interface PromptNativeWindow {
  readonly destroy: () => void;
  readonly getBounds: BrowserWindow["getBounds"];
  readonly getContentBounds: BrowserWindow["getContentBounds"];
  readonly isDestroyed: () => boolean;
  readonly isVisible: () => boolean;
  readonly loadFile: (path: string) => Promise<void>;
  readonly on: (name: "closed", receive: () => void) => void;
  readonly setPosition: (x: number, y: number) => void;
  readonly setSize: (width: number, height: number) => void;
  readonly showInactive: () => void;
  readonly webContents: PromptNativeContents;
}

export interface PromptWindowNative {
  readonly prepare: () => (
    options: Electron.BrowserWindowConstructorOptions
  ) => PromptNativeWindow;
  readonly ipcMain: {
    readonly handle: (
      channel: string,
      listener: (event: PromptIpcEvent) => string
    ) => void;
    readonly on: (channel: string, listener: PromptIpcListener) => void;
    readonly removeHandler: (channel: string) => void;
    readonly removeListener: (
      channel: string,
      listener: PromptIpcListener
    ) => void;
  };
  readonly screen: {
    readonly getCursorScreenPoint: () => Electron.Point;
    readonly getDisplayMatching: (bounds: Electron.Rectangle) => {
      readonly workArea: Electron.Rectangle;
    };
    readonly getDisplayNearestPoint: (point: Electron.Point) => {
      readonly workArea: Electron.Rectangle;
    };
    readonly getPrimaryDisplay: () => { readonly workArea: Electron.Rectangle };
  };
}

const nativePromptWindow: PromptWindowNative = {
  ipcMain: electronIpcMain,
  prepare: () => {
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

    return (options) =>
      new BrowserWindow({
        ...options,
        webPreferences: { ...options.webPreferences, session: partition },
      });
  },
  screen: electronScreen,
};

export const makePromptWindow = Effect.fn("Desktop.makePromptWindow")(
  function* makePromptWindow(
    onAction: (
      action: typeof PromptAction.Type,
      event: AgendaEventValue
    ) => void,
    onClosed: () => void,
    native: PromptWindowNative = nativePromptWindow
  ) {
    const { ipcMain, screen } = native;
    const context = yield* Effect.context();
    const runSync = Effect.runSyncWith(context);

    const current = yield* Ref.make<Option.Option<PromptNativeWindow>>(
      Option.none()
    );

    const soundRequest = yield* Ref.make(0);
    const windowLock = yield* Semaphore.make(1);

    const view = yield* Ref.make<typeof PromptView.Type>({
      events: [],
      revision: 0,
    });

    const lifecycle = yield* startPromptWindowLifecycle();
    const pageUrl = new URL("prompt.html", import.meta.url);
    const create = native.prepare();

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

    const dismiss = Effect.gen(function* dismissPromptWindow() {
      const window = yield* Ref.get(current);

      if (Option.isNone(window) || window.value.isDestroyed()) {
        return;
      }

      const cleared = yield* Ref.updateAndGet(view, (previous) => ({
        events: [],
        revision: previous.revision + 1,
      }));

      const message = Schema.encodeOption(promptWire.view)(cleared);

      if (Option.isSome(message)) {
        window.value.webContents.send(promptChannels.view, message.value);
      }

      yield* Effect.sleep(promptDismissalIntervalMs);
      const latest = yield* Ref.get(current);
      const content = yield* Ref.get(view);

      if (
        Option.isSome(latest) &&
        latest.value === window.value &&
        content.revision === cleared.revision &&
        content.events.length === 0
      ) {
        yield* dispose;
      }
    });

    const close = lifecycle.perform("Dismiss", dismiss);

    const trusted = (event: PromptIpcEvent) => {
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

    const sizeListener: Parameters<typeof ipcMain.on>[1] = (event, value) => {
      if (!trusted(event)) {
        return;
      }

      const report = Schema.decodeUnknownOption(promptWire.size)(value);
      const window = runSync(Ref.get(current));
      const content = runSync(Ref.get(view));

      if (
        Option.isNone(report) ||
        Option.isNone(window) ||
        content.events.length === 0
      ) {
        return;
      }

      const bounds = window.value.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;

      const height = promptMeasuredHeight(
        report.value,
        content.revision,
        bounds.height,
        area.height,
        bounds.height - window.value.getContentBounds().height
      );

      if (height !== undefined) {
        resizePromptWindow(window.value, height, area);
      }
    };

    ipcMain.on(promptChannels.size, sizeListener);

    yield* Effect.addFinalizer(() =>
      lifecycle.perform("Quit", dispose).pipe(
        Effect.orDie,
        Effect.andThen(
          Effect.sync(() => {
            ipcMain.removeHandler(promptChannels.read);
            ipcMain.removeListener(promptChannels.action, actionListener);
            ipcMain.removeListener(promptChannels.size, sizeListener);
          })
        )
      )
    );

    const soundPort = (window: PromptNativeWindow): PromptSoundPort => ({
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
            : create({
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
              lifecycle.actor.send({ type: "Closed" });
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

    const presentContent = Effect.fn("Desktop.presentPromptContent")(
      function* presentContent(
        events: readonly AgendaEventValue[],
        presentation: PromptPresentation
      ) {
        const nextView = yield* Ref.updateAndGet(view, (previous) =>
          nextPromptView(previous, events, presentation)
        );

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
              const area = screen.getDisplayMatching(
                window.getBounds()
              ).workArea;

              resizePromptWindow(
                window,
                promptFallbackHeight(events.length, area.height),
                area
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
                port.send(
                  PromptSoundRequest.cases.Play.make({ request, sound })
                );
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
                revealPromptWindow(window, screen);
              }
            },
          }),
        });
      }
    );

    const present = (
      events: readonly AgendaEventValue[],
      presentation: PromptPresentation
    ) => lifecycle.perform("Present", presentContent(events, presentation));

    const active = Ref.get(current).pipe(
      Effect.map(
        (value) =>
          Option.isSome(value) &&
          !value.value.isDestroyed() &&
          value.value.isVisible()
      )
    );

    const previewContent = Effect.fn("Desktop.previewPromptSoundContent")(
      function* previewContent(
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
                      PromptSoundRequest.cases.Play.make({
                        request,
                        sound: tone,
                      })
                    );
                  }
                }),
            };
          }),
        });
      }
    );

    const preview = Effect.fn("Desktop.previewPromptSound")(function* preview(
      sound: typeof PromptSound.Type,
      enabled: Effect.Effect<boolean>
    ) {
      if (sound === "none" || (yield* active) || !(yield* enabled)) {
        return false;
      }

      return yield* lifecycle.preview(previewContent(sound, enabled));
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
