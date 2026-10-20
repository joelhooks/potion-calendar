// @effect-diagnostics nodeBuiltinImport:off -- This native main adapter stores bounded desktop preferences under fixed user-data paths.
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { Effect, Option } from "effect";
import { app, globalShortcut } from "electron";

import { DesktopError } from "./config.js";
import type { NativeSettingsPort } from "./settings.js";

const maxPreferencesBytes = 64 * 1024;

export const nativeSettingsPort = (
  onShortcut: (action: "menu" | "join") => void
): NativeSettingsPort => {
  const file = path.join(app.getPath("userData"), "desktop.json");
  const temporary = `${file}.tmp`;

  return {
    login: Effect.try({
      catch: (cause) =>
        new DesktopError({
          cause,
          message: "Login-item status could not be read",
        }),
      try: () => app.getLoginItemSettings().openAtLogin,
    }),
    read: Effect.try({
      catch: (cause) =>
        new DesktopError({
          cause,
          message: "Desktop preferences could not be read",
        }),
      try: () => {
        if (!existsSync(file)) {
          return Option.none();
        }

        if (statSync(file).size > maxPreferencesBytes) {
          throw new Error("Desktop preferences exceed the file limit");
        }

        return Option.some(readFileSync(file, "utf-8"));
      },
    }),
    register: (accelerator, action) =>
      Effect.try({
        catch: (cause) =>
          new DesktopError({
            cause,
            message: "Global shortcut could not be registered",
          }),
        try: () =>
          globalShortcut.register(accelerator, () => {
            onShortcut(action);
          }),
      }),
    setLogin: (enabled) =>
      Effect.try({
        catch: (cause) =>
          new DesktopError({
            cause,
            message: "Login-item setting could not be changed",
          }),
        try: () => {
          app.setLoginItemSettings({ openAtLogin: enabled });
        },
      }),
    unregister: (accelerator) =>
      Effect.try({
        catch: (cause) =>
          new DesktopError({
            cause,
            message: "Global shortcut could not be released",
          }),
        try: () => {
          globalShortcut.unregister(accelerator);
        },
      }),
    write: (message) =>
      Effect.try({
        catch: (cause) =>
          new DesktopError({
            cause,
            message: "Desktop preferences could not be saved",
          }),
        try: () => {
          writeFileSync(temporary, message, { mode: 0o600 });
          chmodSync(temporary, 0o600);
          renameSync(temporary, file);
        },
      }),
  };
};
