import {
  desktopChannels,
  nativeNotificationChannels,
} from "@calendar/core/desktop-bridge";
import { Effect, Option, Schema } from "effect";
import { contextBridge, ipcRenderer } from "electron";

import { createDesktopBridge } from "../bridge-client.js";
import type { RendererBridgePort } from "../bridge-client.js";
import { acceptsDesktopFrame } from "../bridge-policy.js";

const rejected = () => {
  Effect.runSync(Effect.logWarning("Rejected desktop bridge payload"));
};

const subscribe = (channel: string, receive: (message: string) => void) => {
  const listener: Parameters<typeof ipcRenderer.on>[1] = (_event, value) => {
    const message = Schema.decodeUnknownOption(Schema.String)(value);

    if (Option.isSome(message)) {
      receive(message.value);
    } else {
      rejected();
    }
  };

  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const rendererPort: RendererBridgePort = {
  // @effect-diagnostics-next-line asyncFunction:off -- The sandboxed preload adapts Electron's native IPC Promise and validates its wire text.
  getSettings: async () => {
    const value: unknown = await ipcRenderer.invoke(desktopChannels.settings);
    const message = Schema.decodeUnknownOption(Schema.String)(value);

    if (Option.isNone(message)) {
      rejected();
      throw new Error("Invalid desktop reply");
    }

    return message.value;
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Native meeting join replies are parsed as wire text before the bridge decodes their domain outcome.
  joinMeeting: async (request) => {
    const value: unknown = await ipcRenderer.invoke(
      desktopChannels.join,
      request
    );

    const message = Schema.decodeUnknownOption(Schema.String)(value);

    if (Option.isNone(message)) {
      rejected();
      throw new Error("Invalid meeting join reply");
    }

    return message.value;
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Native sound preview remains an origin-fenced IPC Promise with a decoded text reply.
  previewSound: async (request) => {
    const value: unknown = await ipcRenderer.invoke(
      desktopChannels.previewSound,
      request
    );

    const message = Schema.decodeUnknownOption(Schema.String)(value);

    if (Option.isNone(message)) {
      rejected();
      throw new Error("Invalid sound preview reply");
    }

    return message.value;
  },
  publishAgenda: (message) => {
    ipcRenderer.send(desktopChannels.agenda, message);
  },
  rejected,
  // @effect-diagnostics-next-line asyncFunction:off -- The dedicated ICS channel returns only decoded wire text; native paths never enter this bridge.
  saveIcs: async (request) => {
    const value: unknown = await ipcRenderer.invoke(
      desktopChannels.saveIcs,
      request
    );

    const message = Schema.decodeUnknownOption(Schema.String)(value);

    if (Option.isNone(message)) {
      rejected();
      throw new Error("Invalid ICS save reply");
    }

    return message.value;
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Electron IPC replies are decoded before exposure to the hosted page.
  savePreferences: async (preferences) => {
    const value: unknown = await ipcRenderer.invoke(
      desktopChannels.preferences,
      preferences
    );

    const message = Schema.decodeUnknownOption(Schema.String)(value);

    if (Option.isNone(message)) {
      rejected();
      throw new Error("Invalid desktop reply");
    }

    return message.value;
  },
  // @effect-diagnostics-next-line asyncFunction:off -- The native login-item boundary uses Electron's invoke Promise.
  setStartup: async (request) => {
    const value: unknown = await ipcRenderer.invoke(
      desktopChannels.startup,
      request
    );

    const message = Schema.decodeUnknownOption(Schema.String)(value);

    if (Option.isNone(message)) {
      rejected();
      throw new Error("Invalid desktop reply");
    }

    return message.value;
  },
  subscribeActions: (receive) => subscribe(desktopChannels.action, receive),
  subscribeSettings: (receive) =>
    subscribe(desktopChannels.settingsChanged, receive),
};

const bridge = createDesktopBridge(
  process.platform === "darwin"
    ? {
        ...rendererPort,
        // @effect-diagnostics-next-line asyncFunction:off -- Mac notification requests use an additive isolated IPC method with decoded wire-text replies.
        nativeNotifications: async (request: string) => {
          const value: unknown = await ipcRenderer.invoke(
            nativeNotificationChannels.request,
            request
          );

          const message = Schema.decodeUnknownOption(Schema.String)(value);

          if (Option.isNone(message)) {
            throw new Error("Invalid notification reply");
          }

          return message.value;
        },
        subscribeNativeNotifications: (receive: (message: string) => void) =>
          subscribe(nativeNotificationChannels.notice, receive),
      }
    : rendererPort
);

const origin = process.argv
  .find((argument) => argument.startsWith("--potion-origin="))
  ?.slice("--potion-origin=".length);

const creationArgument = process.argv
  .find((argument) => argument.startsWith("--potion-window-created-at="))
  ?.slice("--potion-window-created-at=".length);

const windowCreatedAt = Option.fromUndefinedOr(creationArgument).pipe(
  Option.flatMap(Schema.decodeOption(Schema.FiniteFromString))
);

declare const potionPreloadStartedAt: number;

const exposeWithTiming = (createdAt: number) => {
  const timing = { availableAt: potionPreloadStartedAt };

  contextBridge.exposeInMainWorld("potionDesktop", {
    ...bridge,
    getStartupTiming: () => ({
      bridgeAvailableAt: performance.timeOrigin + timing.availableAt,
      coldLoadMilliseconds:
        performance.timeOrigin + timing.availableAt - createdAt,
      preloadMilliseconds: timing.availableAt - potionPreloadStartedAt,
      preloadStartedAt: performance.timeOrigin + potionPreloadStartedAt,
      windowCreatedAt: createdAt,
    }),
  });
  timing.availableAt = performance.now();
};

if (
  origin !== undefined &&
  acceptsDesktopFrame(origin, window.location.href, process.isMainFrame)
) {
  if (Option.isSome(windowCreatedAt)) {
    exposeWithTiming(windowCreatedAt.value);
  } else {
    contextBridge.exposeInMainWorld("potionDesktop", bridge);
  }
}
