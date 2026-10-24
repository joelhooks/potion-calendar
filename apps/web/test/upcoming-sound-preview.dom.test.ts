import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import type {
  DesktopBridge,
  DesktopSettingsValue,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { DesktopRequest } from "../src/client/desktop/model.js";
import { runDesktopRequest } from "../src/client/desktop/runtime.js";

const unexpected = (): never => {
  throw new Error("Unrelated desktop work is forbidden");
};

it.effect.each([
  {
    applied: true,
    error: null,
    expected: 0,
    previewSound: undefined,
    sound: "bell",
  },
  {
    applied: true,
    error: null,
    expected: 0,
    previewSound: false,
    sound: "bell",
  },
  {
    applied: true,
    error: null,
    expected: 1,
    previewSound: true,
    sound: "bell",
  },
  {
    applied: true,
    error: "Preferences changed for this session but could not be saved",
    expected: 1,
    previewSound: true,
    sound: "bell",
  },
  {
    applied: false,
    error: "Preferences refused",
    expected: 0,
    previewSound: true,
    sound: "bell",
  },
  {
    applied: true,
    error: null,
    expected: 0,
    previewSound: true,
    sound: "none",
  },
] as const)(
  "only explicit accepted user changes preview: sound=$sound marker=$previewSound error=$error",
  ({ applied, error, expected, previewSound, sound }) =>
    Effect.gen(function* userPreview() {
      const current: DesktopSettingsValue = {
        issues: [],
        openAtLogin: false,
        preferences: defaultDesktopPreferences(),
        revision: 1,
      };

      const previews: string[] = [];

      const bridge: DesktopBridge = {
        // @effect-diagnostics-next-line asyncFunction:off -- The fake models the isolated preload's native settings Promise.
        getSettings: async () => await Promise.resolve(current),
        joinMeeting: unexpected,
        onAction: unexpected,
        onSettings: unexpected,
        // @effect-diagnostics-next-line asyncFunction:off -- The fake records the explicit native preview handoff without creating browser audio.
        previewSound: async (tone) => {
          previews.push(tone);

          return await Promise.resolve(true);
        },
        publishAgenda: unexpected,
        // @effect-diagnostics-next-line asyncFunction:off -- The fake native writer returns observed preference results through its Promise seam.
        savePreferences: async (preferences) =>
          await Promise.resolve({
            error,
            settings: {
              ...current,
              preferences: applied ? preferences : current.preferences,
              revision: 2,
            },
          }),
        setStartup: unexpected,
      };

      yield* runDesktopRequest(
        DesktopRequest.cases.Read.make({ request: 1 }),
        Option.some(bridge)
      );
      expect(previews).toEqual([]);
      yield* runDesktopRequest(
        DesktopRequest.cases.Save.make({
          preferences: { ...current.preferences, promptSound: sound },
          previewSound,
          request: 2,
        }),
        Option.some(bridge)
      );
      expect(previews).toEqual(expected === 1 ? [sound] : []);
    })
);
