import { promptChannels } from "@calendar/core/desktop-bridge";
import { Effect, Option, Schema } from "effect";
import { contextBridge, ipcRenderer } from "electron";

import { createPromptBridge } from "../prompt-client.js";

const rejected = () => {
  Effect.runSync(Effect.logWarning("Rejected local prompt payload"));
};

const api = createPromptBridge({
  act: (message) => {
    ipcRenderer.send(promptChannels.action, message);
  },
  // @effect-diagnostics-next-line asyncFunction:off -- This actual IPC boundary receives only JSON text; the owned client decodes the closed view contract.
  read: async () => {
    const value: unknown = await ipcRenderer.invoke(promptChannels.read);
    const message = Schema.decodeUnknownOption(Schema.String)(value);

    if (Option.isNone(message)) {
      rejected();
      throw new Error("Invalid prompt content");
    }

    return message.value;
  },
  rejected,
  soundReply: (message) => {
    ipcRenderer.send(promptChannels.soundReply, message);
  },
  subscribe: (receive) => {
    const listener: Parameters<typeof ipcRenderer.on>[1] = (_event, value) => {
      const message = Schema.decodeUnknownOption(Schema.String)(value);

      if (Option.isSome(message)) {
        receive(message.value);
      } else {
        rejected();
      }
    };

    ipcRenderer.on(promptChannels.view, listener);

    return () => {
      ipcRenderer.removeListener(promptChannels.view, listener);
    };
  },
  subscribeSound: (receive) => {
    const listener: Parameters<typeof ipcRenderer.on>[1] = (_event, value) => {
      const message = Schema.decodeUnknownOption(Schema.String)(value);

      if (Option.isSome(message)) {
        receive(message.value);
      } else {
        rejected();
      }
    };

    ipcRenderer.on(promptChannels.sound, listener);

    return () => {
      ipcRenderer.removeListener(promptChannels.sound, listener);
    };
  },
});

const expected = process.argv
  .find((argument) => argument.startsWith("--potion-prompt="))
  ?.slice("--potion-prompt=".length);

if (
  process.isMainFrame &&
  expected !== undefined &&
  window.location.href === expected &&
  expected.startsWith("file:")
) {
  contextBridge.exposeInMainWorld("potionPrompt", api);
}
