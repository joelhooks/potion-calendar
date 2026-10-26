import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { Function } from "effect";

import { createDesktopBridge } from "../src/bridge-client.js";
import type { RendererBridgePort } from "../src/bridge-client.js";

const unexpected = (): never => {
  throw new Error("Unexpected native channel in ICS fixture");
};

export const icsBridgeFixture = (saveIcs?: RendererBridgePort["saveIcs"]) => {
  const state = { rejections: 0 };

  const port: RendererBridgePort = {
    // oxlint-disable-next-line typescript/promise-function-async -- The owned fake exposes a resolved native settings Promise without another Effect runtime.
    getSettings: () =>
      Promise.resolve(
        JSON.stringify({
          issues: [],
          openAtLogin: false,
          preferences: defaultDesktopPreferences(),
          revision: 1,
        })
      ),
    joinMeeting: unexpected,
    publishAgenda: unexpected,
    rejected: () => {
      state.rejections += 1;
    },
    savePreferences: unexpected,
    setStartup: unexpected,
    subscribeActions: () => Function.constVoid,
    subscribeSettings: () => Function.constVoid,
  };

  const transport = saveIcs === undefined ? port : { ...port, saveIcs };

  return { bridge: createDesktopBridge(transport), port: transport, state };
};
