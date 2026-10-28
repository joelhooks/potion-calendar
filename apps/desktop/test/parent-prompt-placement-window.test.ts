import { pathToFileURL } from "node:url";

import {
  AgendaSnapshot,
  defaultDesktopPreferences,
  promptChannels,
  promptWire,
} from "@calendar/core/desktop-bridge";
import type {
  AgendaSnapshotValue,
  PromptSound,
  PromptSoundRequest,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Deferred, Effect, Option, Predicate, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";

import { desktopAgendaReceiver } from "../src/agenda-receiver.js";
import { startNativeHost } from "../src/native-host.js";
import { startPrompt } from "../src/prompt-machine.js";
import { makePromptWindow } from "../src/prompt-window.js";
import type { PromptWindowNative } from "../src/prompt-window.js";
import {
  promptMeeting,
  promptNow,
  promptPreferences,
} from "./prompt-preferences-fixture.js";

const fixture = (primaryWidth = 900) => {
  let bounds = { height: 170, width: 380, x: 0, y: 0 };
  let visible = false;
  let destroyed = false;
  let url = "";
  let shows = 0;
  const views: string[] = [];
  const sounds: (typeof PromptSoundRequest.Type)[] = [];
  let soundWaiter: Deferred.Deferred<number> | undefined;
  const positions: { readonly x: number; readonly y: number }[] = [];
  const callbacks = new Map<string, () => void>();

  const listeners = new Map<
    string,
    Parameters<PromptWindowNative["ipcMain"]["on"]>[1]
  >();

  const cursor = { height: 700, width: 1300, x: -1800, y: 35 };
  let primary = { height: 500, width: primaryWidth, x: 2200, y: 80 };

  const window = {
    destroy: () => {
      destroyed = true;
      callbacks.get("closed")?.();
    },
    getBounds: () => ({ ...bounds }),
    getContentBounds: () => ({ ...bounds }),
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    // oxlint-disable-next-line typescript/promise-function-async -- Electron's loadFile port returns a settled native Promise without running an Effect runtime.
    loadFile: (path: string) => {
      url = pathToFileURL(path).href;
      window.webContents.mainFrame.url = url;

      return Promise.resolve();
    },
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The native adapter stores Electron's synchronous closed callback for the fake window.
    on: (name: string, callback: () => void) => {
      callbacks.set(name, callback);
    },
    setPosition: (x: number, y: number) => {
      bounds = { ...bounds, x, y };
      positions.push({ x, y });
    },
    setSize: (width: number, height: number) => {
      bounds = { ...bounds, height, width };
    },
    showInactive: () => {
      visible = true;
      shows += 1;
    },
    webContents: {
      getURL: () => url,
      isLoadingMainFrame: () => false,
      mainFrame: { url: "" },
      on: () => {},
      send: (channel: string, value: string) => {
        if (channel === promptChannels.view) {
          views.push(value);
        }

        if (channel === promptChannels.sound) {
          const decoded = Schema.decodeOption(promptWire.sound)(value);

          if (Option.isSome(decoded)) {
            sounds.push(decoded.value);

            if (
              Predicate.isTagged(decoded.value, "Load") &&
              soundWaiter !== undefined
            ) {
              Deferred.doneUnsafe(
                soundWaiter,
                Effect.succeed(decoded.value.request)
              );
            }
          }
        }
      },
      setWindowOpenHandler: () => {},
    },
  };

  const native: PromptWindowNative = {
    ipcMain: {
      handle: () => {},
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The IPC port stores Electron's synchronous listener without introducing async control flow.
      on: (channel, callback) => {
        listeners.set(channel, callback);
      },
      removeHandler: () => {},
      removeListener: (channel) => {
        listeners.delete(channel);
      },
    },
    prepare: () => () => window,
    screen: {
      getCursorScreenPoint: () => ({ x: -1700, y: 60 }),
      getDisplayMatching: () => ({
        workArea: bounds.x >= 2000 ? primary : cursor,
      }),
      getDisplayNearestPoint: () => ({ workArea: cursor }),
      getPrimaryDisplay: () => ({ workArea: primary }),
    },
  };

  return {
    cursor,
    hide: () => {
      visible = false;
    },
    listeners,
    native,
    positions,
    primary: () => primary,
    replacePrimary: () => {
      primary = { ...primary, height: 320, x: 4300, y: 110 };
    },
    shows: () => shows,
    sounds,
    views,
    waitForLoad: (waiter: Deferred.Deferred<number>) => {
      soundWaiter = waiter;
    },
    window,
  };
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Malformed optional parent placement is decoded by the actual AgendaSnapshot schema before publication.
const parentSnapshot = (placement: unknown, revision = 1) =>
  Schema.decodeUnknownEffect(AgendaSnapshot)({
    events: [promptMeeting],
    notificationAgenda: {
      deliveries: [],
      events: [],
      lease: "current-parent",
      personId: "current-person",
      revision,
      version: 1,
    },
    promptPreferences: { ...promptPreferences, placement },
  });

const openParent = Effect.fn("Test.openParentPlacement")(function* openParent(
  f: ReturnType<typeof fixture>,
  sound: typeof PromptSound.Type = "none"
) {
  yield* TestClock.setTime(promptNow);

  const window = yield* makePromptWindow(
    () => {},
    () => {},
    f.native
  );

  const preferences = {
    ...defaultDesktopPreferences(),
    promptSound: sound,
  } as const;

  const actor = yield* startPrompt(window, {
    now: promptNow,
    preferences,
    snapshot: { events: [] },
  });

  const host = yield* startNativeHost(
    {
      intents: Stream.empty,
      perform: () => Effect.void,
      render: (view) =>
        send(actor, {
          now: view.now,
          preferences: view.preferences,
          snapshot: view.agenda,
          type: "Input",
        }),
    },
    { now: promptNow, preferences }
  );

  const publish = Effect.fn("Test.publishParentPlacement")(function* publish(
    snapshot: AgendaSnapshotValue,
    completion: "visible" | "pending" = "visible"
  ) {
    let accepted: AgendaSnapshotValue | undefined;

    const receive = desktopAgendaReceiver("https://calendar.example.test", {
      accepted: (value) => {
        accepted = value;
      },
      rejected: () => {
        throw new Error("Rejected valid parent placement");
      },
      trusted: (trusted: boolean) => trusted,
    });

    const encoded = yield* Schema.encodeEffect(
      Schema.fromJsonString(AgendaSnapshot)
    )(snapshot);

    receive(true, encoded);

    if (accepted === undefined) {
      return yield* Effect.die("Missing accepted parent snapshot");
    }

    yield* send(host.actor, { snapshot: accepted, type: "Agenda" });
    yield* waitFor(host.actor, (s) => s.matches({ active: "idle" }), {
      timeout: "1 second",
    }).pipe(Effect.orDie);

    if (completion === "pending") {
      return yield* Effect.void;
    }

    yield* waitFor(
      actor,
      (s) =>
        s.matches("visible") &&
        s.context.snapshot.notificationAgenda?.revision ===
          snapshot.notificationAgenda?.revision &&
        s.context.snapshot.promptPreferences?.placement?.display ===
          snapshot.promptPreferences?.placement?.display,
      { timeout: "1 second" }
    ).pipe(Effect.orDie);

    return yield* Effect.void;
  });

  return { actor, preferences, publish, window };
});

it.effect(
  "HIGH accepted parent primary placement keeps the left origin on a real work area narrower than the window",
  () =>
    Effect.gen(function* narrowPrimaryRecipient() {
      const f = fixture(180);
      const p = yield* openParent(f);
      yield* p.publish(
        yield* parentSnapshot({
          anchor: "topCenter",
          display: "primary",
          x: -999_999,
          y: 999_999,
        })
      );
      expect(f.window.getBounds().x).toBe(f.primary().x);
      expect(f.window.getBounds().y).toBe(f.primary().y + 8);
      expect(f.window.getBounds().height).toBeLessThanOrEqual(
        f.primary().height
      );
      expect(f.shows()).toBe(1);
      expect(f.views.at(-1)).not.toContain("authority");
    }).pipe(Effect.scoped)
);

it.effect.each([
  undefined,
  null,
  { anchor: "invalid", display: "primary" },
  { anchor: "topCenter", display: "cursor" },
])(
  "legacy or invalid placement uses identical cursor geometry: %j",
  (placement) =>
    Effect.gen(function* defaultPlacement() {
      const f = fixture();
      const p = yield* openParent(f);
      yield* p.publish(yield* parentSnapshot(placement));
      expect(f.positions).toEqual([{ x: -1340, y: 43 }]);
      expect(f.shows()).toBe(1);
    }).pipe(Effect.scoped)
);

it.effect(
  "accepted changed policy repositions without reveal; repeated policy is stable and hidden redisplay uses the latest real area",
  () =>
    Effect.gen(function* visiblePolicyHistory() {
      const f = fixture();
      const p = yield* openParent(f);
      yield* p.publish(
        yield* parentSnapshot({ anchor: "topCenter", display: "cursor" })
      );
      yield* p.publish(
        yield* parentSnapshot({ anchor: "topCenter", display: "primary" }, 2)
      );
      expect(f.window.getBounds().x).toBe(2460);
      expect(f.shows()).toBe(1);
      const positions = [...f.positions];
      yield* p.publish(
        yield* parentSnapshot({ anchor: "topCenter", display: "primary" }, 3)
      );
      expect(f.positions).toEqual(positions);
      f.hide();
      f.replacePrimary();
      yield* p.window.present([promptMeeting], {
        authority: {
          lease: "current-parent",
          personId: "current-person",
          revision: 4,
        },
        preferences: {
          ...promptPreferences,
          placement: { anchor: "topCenter", display: "primary" },
        },
        reveal: true,
        sound: "none",
      });
      expect(f.window.getBounds().x).toBe(4560);
      expect(f.window.getBounds().y).toBe(118);
      expect(f.shows()).toBe(2);
    }).pipe(Effect.scoped)
);

it.effect(
  "old measured revision and a foreign parent lease cannot move the current prompt",
  () =>
    Effect.gen(function* refusedPlacementHistory() {
      const f = fixture();
      const p = yield* openParent(f);
      yield* p.publish(
        yield* parentSnapshot({ anchor: "topCenter", display: "primary" }, 3)
      );
      const positions = [...f.positions];

      const valid = yield* parentSnapshot(
        { anchor: "topCenter", display: "cursor" },
        2
      );

      yield* send(p.actor, {
        now: promptNow,
        preferences: p.preferences,
        snapshot: valid,
        type: "Input",
      });
      const agenda = valid.notificationAgenda;

      if (agenda === undefined) {
        return yield* Effect.die("Missing scoped test agenda");
      }

      yield* send(p.actor, {
        snapshot: {
          ...valid,
          notificationAgenda: { ...agenda, lease: "foreign-parent" },
        },
        type: "Agenda",
      });
      yield* waitFor(
        p.actor,
        (s) =>
          s.matches("visible") &&
          s.context.snapshot.notificationAgenda?.lease === "foreign-parent",
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      const size = f.listeners.get(promptChannels.size);
      expect(size).toBeDefined();
      size?.(
        {
          sender: f.window.webContents,
          senderFrame: f.window.webContents.mainFrame,
        },
        JSON.stringify({ height: 999, revision: 0 })
      );
      expect(f.positions).toEqual(positions);
      expect(f.shows()).toBe(1);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "a superseded sound completion cannot place or reveal the current generation",
  () =>
    Effect.gen(function* realWindowSoundRace() {
      const f = fixture();
      const p = yield* openParent(f, "bell");
      const first = yield* Deferred.make<number>();
      f.waitForLoad(first);
      yield* p.publish(
        yield* parentSnapshot({ anchor: "topCenter", display: "cursor" }),
        "pending"
      );
      const oldRequest = yield* Deferred.await(first);
      const second = yield* Deferred.make<number>();
      f.waitForLoad(second);
      yield* p.publish(
        yield* parentSnapshot({ anchor: "topCenter", display: "primary" }, 2),
        "pending"
      );
      const newRequest = yield* Deferred.await(second);
      expect(newRequest).toBeGreaterThan(oldRequest);
      const reply = f.listeners.get(promptChannels.soundReply);
      expect(reply).toBeDefined();
      reply?.(
        {
          sender: f.window.webContents,
          senderFrame: f.window.webContents.mainFrame,
        },
        yield* Schema.encodeEffect(promptWire.soundReply)({
          phase: "load",
          ready: true,
          request: oldRequest,
        })
      );
      expect(f.positions).toEqual([]);
      expect(f.shows()).toBe(0);
      reply?.(
        {
          sender: f.window.webContents,
          senderFrame: f.window.webContents.mainFrame,
        },
        yield* Schema.encodeEffect(promptWire.soundReply)({
          phase: "load",
          ready: true,
          request: newRequest,
        })
      );
      yield* waitFor(
        p.actor,
        (s) =>
          s.matches("visible") &&
          s.context.snapshot.notificationAgenda?.revision === 2,
        { timeout: "1 second" }
      ).pipe(Effect.orDie);
      expect(f.positions).toEqual([{ x: 2460, y: 88 }]);
      expect(f.shows()).toBe(1);
      expect(f.sounds.filter(Predicate.isTagged("Play"))).toHaveLength(1);
      expect(
        f.sounds
          .filter(Predicate.isTagged("Cancel"))
          .map((sound) => sound.request)
      ).toContain(oldRequest);
    }).pipe(Effect.scoped)
);

it.effect(
  "current measured resize uses the real latest primary area while stale reports and close cannot move it",
  () =>
    Effect.gen(function* primaryResizeHistory() {
      const f = fixture();
      const p = yield* openParent(f);
      yield* p.publish(
        yield* parentSnapshot({ anchor: "topCenter", display: "primary" })
      );

      const view = yield* Schema.decodeUnknownEffect(promptWire.view)(
        f.views.at(-1)
      );

      const size = f.listeners.get(promptChannels.size);
      expect(size).toBeDefined();

      const event = {
        sender: f.window.webContents,
        senderFrame: f.window.webContents.mainFrame,
      };

      size?.(
        event,
        yield* Schema.encodeEffect(promptWire.size)({
          height: 999,
          revision: view.revision,
        })
      );
      expect(f.window.getBounds()).toEqual({
        height: 500,
        width: 380,
        x: 2460,
        y: 80,
      });
      f.replacePrimary();
      size?.(
        event,
        yield* Schema.encodeEffect(promptWire.size)({
          height: 999,
          revision: view.revision,
        })
      );
      expect(f.window.getBounds().height).toBe(320);
      expect(f.window.getBounds().x).toBeGreaterThanOrEqual(f.primary().x);
      expect(f.window.getBounds().y).toBeGreaterThanOrEqual(f.primary().y);
      expect(f.shows()).toBe(1);
      const positions = [...f.positions];
      yield* send(p.actor, { snapshot: { events: [] }, type: "Agenda" });
      yield* TestClock.adjust("200 millis");
      yield* waitFor(p.actor, (s) => s.matches("idle"), {
        timeout: "1 second",
      }).pipe(Effect.orDie);
      size?.(
        event,
        yield* Schema.encodeEffect(promptWire.size)({
          height: 100,
          revision: view.revision,
        })
      );
      expect(f.positions).toEqual(positions);
    }).pipe(Effect.scoped)
);
