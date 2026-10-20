import { desktopChannels } from "@calendar/core/desktop-bridge";
import { Schema } from "effect";
import type { BrowserWindow } from "electron";
import type { ElectronApplication, Page } from "playwright-core";

import { NativeTrace } from "./hosted-diagnostics.ts";

// @effect-diagnostics-next-line asyncFunction:off -- The owned Mac observer buffers real main-process IPC without changing application handlers.
export const observeHostedAgenda = async (
  application: ElectronApplication,
  page: Page,
  title: string
) => {
  const owner = await application.browserWindow(page);
  const ownerId = await owner.evaluate((window: BrowserWindow) => window.id);

  const received = application.evaluate(
    // @effect-diagnostics-next-line asyncFunction:off -- The native publication deadline starts only after the driver reports the actual save acknowledgement.
    async (
      { app, BrowserWindow, ipcMain },
      { channel, title: expectedTitle, ownerId: expectedWindow }
    ) => {
      const { EventEmitter } = process.getBuiltinModule("node:events");
      const [window] = BrowserWindow.getAllWindows();

      if (window === undefined) {
        throw new Error("Hosted publication main window is missing");
      }

      const controller = new AbortController();
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- This clock must remain inside the serialized Electron callback.
      const timestamp = () => performance.timeOrigin + performance.now();

      const publications: {
        timestamp: number;
        payload: string;
        navigated: boolean;
        sameSender: boolean;
        sameFrameObject: boolean;
        sameFrameCoordinates: boolean;
      }[] = [];

      const navigations: { timestamp: number; kind: string }[] = [];
      let dropped = 0;
      let navigated = false;
      let deadline = Number.POSITIVE_INFINITY;
      let matched: { timestamp: number; payload: string } | undefined;
      let payload = '{"events":[]}';

      const armed = EventEmitter.once(app, "desktop-proof-hosted-arm", {
        signal: controller.signal,
      });

      const navigation = (kind: string) => {
        if (navigations.length < 128) {
          navigations.push({ kind, timestamp: timestamp() });
        }
      };

      const started = () => {
        navigation("started");
      };

      const loaded = () => {
        navigated = true;
        navigation("navigated");
      };

      const finished = () => {
        navigation("finished");
      };

      const stopped = () => {
        navigation("stopped");
      };

      const listener: Parameters<typeof ipcMain.on>[1] = (event, value) => {
        const raw = String(value);
        const sameSender = event.sender === window.webContents;

        const sameFrameObject =
          event.senderFrame === window.webContents.mainFrame;

        const sameFrameCoordinates =
          event.senderFrame?.processId ===
            window.webContents.mainFrame.processId &&
          event.senderFrame?.routingId ===
            window.webContents.mainFrame.routingId;

        const record = {
          navigated,
          payload: raw,
          sameFrameCoordinates,
          sameFrameObject,
          sameSender,
          timestamp: timestamp(),
        };

        if (publications.length < 512) {
          publications.push(record);
        } else {
          dropped += 1;
        }

        if (!navigated || !sameSender || !sameFrameObject) {
          return;
        }

        payload = raw;

        if (raw.includes(JSON.stringify(expectedTitle))) {
          matched = { payload: raw, timestamp: record.timestamp };

          if (record.timestamp <= deadline) {
            app.emit("desktop-proof-hosted-ready", raw);
          }
        }

        if (raw === '{"events":[]}') {
          app.emit("desktop-proof-hosted-empty", raw);
        }
      };

      const inspect = () => {
        app.emit("desktop-proof-hosted-trace", {
          dropped,
          navigations,
          publications,
          selectedWindowMatchesPage: window.id === expectedWindow,
          windowCount: BrowserWindow.getAllWindows().length,
        });
      };

      const cleanup = () => {
        controller.abort();
        ipcMain.removeListener(channel, listener);
        window.webContents.removeListener("did-start-navigation", started);
        window.webContents.removeListener("did-navigate", loaded);
        window.webContents.removeListener("did-finish-load", finished);
        window.webContents.removeListener("did-stop-loading", stopped);
        EventEmitter.prototype.removeListener.call(
          app,
          "desktop-proof-hosted-inspect",
          inspect
        );
      };

      ipcMain.on(channel, listener);
      window.webContents.on("did-start-navigation", started);
      window.webContents.on("did-navigate", loaded);
      window.webContents.on("did-finish-load", finished);
      window.webContents.on("did-stop-loading", stopped);
      EventEmitter.prototype.on.call(
        app,
        "desktop-proof-hosted-inspect",
        inspect
      );
      EventEmitter.prototype.once.call(
        app,
        "desktop-proof-hosted-cleanup",
        cleanup
      );

      try {
        const values: readonly unknown[] = await armed;
        const saveAt = Number(values[0]);
        deadline = saveAt + 30_000;

        if (matched !== undefined && matched.timestamp <= saveAt + 30_000) {
          return { delivered: true, payload: matched.payload };
        }

        const remaining = Math.max(1, Math.ceil(saveAt + 30_000 - timestamp()));

        const ready: readonly unknown[] = await EventEmitter.once(
          app,
          "desktop-proof-hosted-ready",
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(remaining),
            ]),
          }
        );

        return { delivered: true, payload: String(ready[0]) };
      } catch {
        return { delivered: false, payload };
      }
    },
    { channel: desktopChannels.agenda, ownerId, title }
  );

  if (
    (await application.evaluate(({ app }) =>
      app.listenerCount("desktop-proof-hosted-inspect")
    )) !== 1
  ) {
    throw new Error("Hosted observer must be installed before reload");
  }

  return {
    // @effect-diagnostics-next-line asyncFunction:off -- Arming is a single driver-to-main lifecycle signal after save acknowledgement.
    arm: async (saveAt: number) => {
      await application.evaluate(({ app }, at) => {
        app.emit("desktop-proof-hosted-arm", at);
      }, saveAt);
    },
    // @effect-diagnostics-next-line asyncFunction:off -- Cleanup aborts the owned receiver before removing its diagnostic listeners.
    close: async () => {
      await application.evaluate(({ app }) => {
        app.emit("desktop-proof-hosted-cleanup");
      });
      await received;
      await owner.dispose();
    },
    received,
    // @effect-diagnostics-next-line asyncFunction:off -- A bounded read copies the observer's private trace for failure-only redacted formatting.
    trace: async () => {
      const input = await application.evaluate(
        // @effect-diagnostics-next-line asyncFunction:off -- Native EventEmitter owns this bounded diagnostic rendezvous.
        async ({ app }) => {
          const { EventEmitter } = process.getBuiltinModule("node:events");

          const ready = EventEmitter.once(app, "desktop-proof-hosted-trace", {
            signal: AbortSignal.timeout(5000),
          });

          app.emit("desktop-proof-hosted-inspect");
          const result: readonly unknown[] = await ready;

          return result[0];
        }
      );

      return Schema.decodeUnknownOption(NativeTrace)(input);
    },
  };
};
