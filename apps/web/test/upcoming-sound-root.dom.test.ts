import type {
  DesktopBridge,
  DesktopPreferencesValue,
  DesktopSettingsValue,
  PromptSound,
} from "@calendar/core/desktop-bridge";
import { defaultDesktopPreferences } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { AsyncData } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { Scene } from "foldkit/test";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { ApplyDesktopRequest } from "../src/client/desktop/commands.js";
import {
  DesktopNotice,
  DesktopRequest,
  RemoteDesktop,
  initialDesktop,
} from "../src/client/desktop/model.js";
import { EditingRuntime } from "../src/client/editing/runtime.js";
import type { AppMessage } from "../src/client/message.js";
import { CalendarSearchClient } from "../src/client/search/client.js";
import { desktopSettingsView } from "../src/features/desktop-settings-actions.js";
import { desktopNotificationRows } from "../src/features/desktop-settings.js";
import { SettingsRoute } from "../src/layout/route.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { fixtureModel } from "./fixture.js";

const unexpected = () => {
  throw new Error(
    "Upcoming sound settings must not invoke another native port"
  );
};

const forbiddenDomainWork = Effect.die(
  new Error("Upcoming sound settings must not invoke editing or search")
);

const rootFence = Layer.mergeAll(
  unusedBrowserLayers,
  Layer.succeed(
    EditingRuntime,
    EditingRuntime.of({
      connect: () => forbiddenDomainWork,
      dispatch: () => forbiddenDomainWork,
    })
  ),
  Layer.succeed(
    CalendarSearchClient,
    CalendarSearchClient.of({
      prefetch: () => forbiddenDomainWork,
      search: () => forbiddenDomainWork,
    })
  )
);

interface NativeSoundState {
  current: DesktopSettingsValue;
  previews: (typeof PromptSound.Type)[];
  reads: number;
  saves: DesktopPreferencesValue[];
}

const makeNative = (applied: boolean, error: string | null) => {
  const state: NativeSoundState = {
    current: {
      issues: [],
      openAtLogin: false,
      preferences: defaultDesktopPreferences(),
      revision: 1,
    },
    previews: [],
    reads: 0,
    saves: [],
  };

  const bridge: DesktopBridge = {
    // @effect-diagnostics-next-line asyncFunction:off -- The fake native reader reports calls through its Promise boundary.
    getSettings: async () => {
      state.reads += 1;

      return await Promise.resolve(state.current);
    },
    joinMeeting: unexpected,
    onAction: unexpected,
    onSettings: unexpected,
    // @effect-diagnostics-next-line asyncFunction:off -- The fake native preview records its Promise handoff without audio.
    previewSound: async (sound) => {
      state.previews.push(sound);

      return await Promise.resolve(true);
    },
    publishAgenda: unexpected,
    // @effect-diagnostics-next-line asyncFunction:off -- The fake native writer returns its observed choice through the Promise seam.
    savePreferences: async (preferences) => {
      state.saves.push(preferences);
      state.current = {
        ...state.current,
        preferences: applied ? preferences : state.current.preferences,
        revision: state.current.revision + 1,
      };

      return await Promise.resolve({ error, settings: state.current });
    },
    setStartup: unexpected,
  };

  return { bridge, state };
};

const installNative = (bridge: DesktopBridge) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const previous = Object.getOwnPropertyDescriptor(window, "potionDesktop");

      Object.defineProperty(window, "potionDesktop", {
        configurable: true,
        value: bridge,
      });

      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          Reflect.deleteProperty(window, "potionDesktop");
        } else {
          Object.defineProperty(window, "potionDesktop", previous);
        }
      })
  );

const rootModel = (settings: DesktopSettingsValue): AppModel => ({
  ...fixtureModel(),
  desktop: {
    ...initialDesktop(),
    availability: "available",
    request: 37,
    settings: RemoteDesktop.Success({ data: settings }),
  },
  route: SettingsRoute.make({ page: "notifications" }),
});

const settingsView = (model: AppModel, h: HtmlBuilder<AppMessage>) =>
  h.div([], desktopSettingsView(model.desktop, h, desktopNotificationRows));

const executeRoot = Effect.fn("SoundSettings.executeActualRootCommand")(
  function* executeRootRequest(result: ReturnType<typeof update>) {
    expect(result.commands?.map((command) => command.name)).toEqual([
      ApplyDesktopRequest.name,
    ]);
    let { model } = result;

    for (const command of result.commands ?? []) {
      const notice = yield* command.effect;
      const { model: received, commands } = update(model, notice);

      expect(commands ?? []).toEqual([]);
      model = received;
    }

    expect(AsyncData.isSuccess(model.desktop.settings)).toBe(true);

    return model;
  }
);

it.effect.each([
  { applied: true, error: null, previews: 1, sound: "bell" },
  { applied: true, error: null, previews: 1, sound: "tap" },
  { applied: true, error: null, previews: 0, sound: "blip" },
  { applied: true, error: null, previews: 0, sound: "none" },
  {
    applied: true,
    error: "Preferences apply to this session; persistence is unavailable.",
    previews: 1,
    sound: "bell",
  },
  {
    applied: false,
    error: "The native owner refused this choice.",
    previews: 0,
    sound: "bell",
  },
] as const)(
  "the actual $sound select crosses the root and native command with $previews previews when applied=$applied and error=$error",
  ({ applied, error, previews, sound }) =>
    Effect.gen(function* actualSoundSelectRecipient() {
      const native = makeNative(applied, error);

      yield* installNative(native.bridge);
      const transitions: ReturnType<typeof update>[] = [];
      const messages: AppMessage[] = [];
      const model = rootModel(native.state.current);

      Scene.scene(
        {
          update: (current: AppModel, message: AppMessage) => {
            messages.push(message);
            const result = update(current, message);

            transitions.push(result);

            return { model: result.model };
          },
          view: settingsView,
        },
        Scene.given(model),
        Scene.change(Scene.selector("#desktop-prompt-sound"), sound)
      );
      expect(messages).toEqual([
        Message.RequestedDesktop({
          request: DesktopRequest.cases.Save.make({
            preferences: {
              ...native.state.current.preferences,
              promptSound: sound,
            },
            previewSound: sound !== "blip",
            request: 38,
          }),
        }),
      ]);
      expect(transitions).toHaveLength(1);
      const [requested] = transitions;
      const result = Option.getOrThrow(Option.fromUndefinedOr(requested));
      const finished = yield* executeRoot(result);

      expect(native.state.saves).toEqual([
        { ...defaultDesktopPreferences(), promptSound: sound },
      ]);
      expect(native.state.previews).toEqual(previews === 1 ? [sound] : []);
      expect(native.state.reads).toBe(0);
      expect(finished.desktop.request).toBe(38);
      expect(
        Option.getOrThrow(AsyncData.getData(finished.desktop.settings))
      ).toEqual(native.state.current);
    }).pipe(Effect.provide(rootFence), Effect.scoped)
);

it.effect(
  "initial rendering, a real root Read and native settings sync never request a preview",
  () =>
    Effect.gen(function* soundReadAndSyncRecipient() {
      const native = makeNative(true, null);

      yield* installNative(native.bridge);
      const model = rootModel(native.state.current);
      const rendered: AppMessage[] = [];

      Scene.scene(
        {
          update: (current: AppModel, message: AppMessage) => {
            rendered.push(message);

            return update(current, message);
          },
          view: settingsView,
        },
        Scene.given(model)
      );
      expect(rendered).toEqual([]);

      const read = update(
        model,
        Message.RequestedDesktop({
          request: DesktopRequest.cases.Read.make({ request: 999 }),
        })
      );

      const ready = yield* executeRoot(read);

      const synced = update(
        ready,
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Settings.make({
            settings: {
              ...native.state.current,
              preferences: {
                ...native.state.current.preferences,
                promptSound: "bell",
              },
              revision: 10,
            },
          }),
        })
      );

      expect(synced.commands ?? []).toEqual([]);
      expect(
        Option.getOrThrow(AsyncData.getData(synced.model.desktop.settings))
          .preferences.promptSound
      ).toBe("bell");
      expect(native.state.reads).toBe(1);
      expect(native.state.saves).toEqual([]);
      expect(native.state.previews).toEqual([]);
      expect(ready.desktop.request).toBe(38);
    }).pipe(Effect.provide(rootFence), Effect.scoped)
);
