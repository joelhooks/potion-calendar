import { pathToFileURL } from "node:url";

import {
  defaultDesktopPreferences,
  promptChannels,
  promptWire,
} from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import { Effect, Exit, Fiber, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";

import { startPrompt } from "../src/prompt-machine.js";
import type { promptMachine } from "../src/prompt-machine.js";
import { promptDismissalIntervalMs } from "../src/prompt-window-lifecycle.js";
import { makePromptWindow } from "../src/prompt-window.js";
import type { PromptWindowNative } from "../src/prompt-window.js";

interface PromptParent {
  actor?: EffectActor<ReturnType<typeof promptMachine>>;
}

class FakeWindow {
  destroyed = false;
  destroys = 0;
  visible = false;
  sendsAfterDestroy = 0;
  views: string[] = [];
  callbacks = new Map<string, () => void>();
  url = "";
  bounds = { height: 170, width: 380, x: 0, y: 0 };
  webContents = {
    getURL: () => this.url,
    isLoadingMainFrame: () => false,
    mainFrame: { url: "" },
    on: () => {},
    send: (channel: string, value: string) => {
      if (this.destroyed) {
        this.sendsAfterDestroy += 1;
      }

      if (channel === promptChannels.view) {
        this.views.push(value);
      }
    },
    setWindowOpenHandler: () => {},
  };
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The supplied native window faithfully exposes Electron's synchronous closed listener.
  on(name: string, receive: () => void) {
    this.callbacks.set(name, receive);
  }
  isDestroyed() {
    return this.destroyed;
  }
  isVisible() {
    return this.visible;
  }
  getBounds() {
    return this.bounds;
  }
  getContentBounds() {
    return this.bounds;
  }
  setSize(width: number, height: number) {
    this.bounds = { ...this.bounds, height, width };
  }
  setPosition(x: number, y: number) {
    this.bounds = { ...this.bounds, x, y };
  }
  showInactive() {
    this.visible = true;
  }
  // oxlint-disable-next-line typescript/promise-function-async -- Electron's faithful loadFile port returns an already-settled Promise, not an Effect runtime.
  loadFile(path: string) {
    this.url = pathToFileURL(path).href;
    this.webContents.mainFrame.url = this.url;

    return Promise.resolve();
  }
  destroy() {
    this.destroys += 1;
    this.destroyed = true;
    this.callbacks.get("closed")?.();
  }
}

const nativeFixture = () => {
  const windows: FakeWindow[] = [];

  const listeners = new Map<
    string,
    Parameters<PromptWindowNative["ipcMain"]["on"]>[1]
  >();

  const area = { height: 1000, width: 1200, x: 0, y: 0 };

  const native: PromptWindowNative = {
    ipcMain: {
      handle: () => {},
      on: (channel, listener) => {
        listeners.set(channel, listener);
      },
      removeHandler: () => {},
      removeListener: (channel) => {
        listeners.delete(channel);
      },
    },
    prepare: () => () => {
      const window = new FakeWindow();
      windows.push(window);

      return window;
    },
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayMatching: () => ({ workArea: area }),
      getDisplayNearestPoint: () => ({ workArea: area }),
      getPrimaryDisplay: () => ({ workArea: area }),
    },
  };

  return { listeners, native, windows };
};

const now = 1_792_497_600_000;

const meeting: AgendaEventValue = {
  allDay: false,
  calendarColor: "#64748b",
  conferenceUrl: "https://meet.example.test/room",
  end: now + 3_600_000,
  hasLocation: false,
  hasParticipants: true,
  key: { accountId: "work", calendarId: "primary", eventId: "one" },
  responseStatus: "accepted",
  start: now,
  title: "First meeting",
};

const presentation = { reveal: true, sound: "none" } as const;

const latest = (window: FakeWindow) =>
  Schema.decodeUnknownOption(promptWire.view)(window.views.at(-1));

const windowAt = (windows: readonly FakeWindow[], index: number) => {
  const window = windows[index];

  if (window === undefined) {
    throw new Error("Missing actual window adapter handle");
  }

  return window;
};

it.effect(
  "last-item removal clears the real adapter view now but destroys only at the virtual dismissal deadline",
  () =>
    Effect.gen(function* deadline() {
      const { native, windows } = nativeFixture();

      const adapter = yield* makePromptWindow(
        () => {},
        () => {},
        native
      );

      yield* adapter.present([meeting], presentation);
      const window = windowAt(windows, 0);
      const closing = yield* Effect.forkChild(adapter.close);
      yield* TestClock.adjust(0);
      expect(latest(window)).toMatchObject({ value: { events: [] } });
      expect(window.destroyed).toBe(false);
      yield* TestClock.adjust(promptDismissalIntervalMs - 1);
      expect(window.destroyed).toBe(false);
      yield* TestClock.adjust(1);
      yield* Fiber.join(closing);
      expect(window.destroys).toBe(1);
      expect(window.sendsAfterDestroy).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "HIGH a new prompt during actual machine dismissal reuses the handle and survives every old deadline",
  {
    before: Schema.Int.check(Schema.isBetween({ maximum: 199, minimum: 0 })),
  },
  ({ before }) =>
    Effect.gen(function* arrivalHistory() {
      const { native, windows } = nativeFixture();

      const parent: PromptParent = {};

      const adapter = yield* makePromptWindow(
        () => {},
        () => {
          parent.actor?.send({ type: "Closed" });
        },
        native
      );

      const preferences = {
        ...defaultDesktopPreferences(),
        promptSound: "none" as const,
      };

      const actor = yield* startPrompt(adapter, {
        now,
        preferences,
        snapshot: { events: [meeting] },
      });

      parent.actor = actor;
      yield* waitFor(actor, (s) => s.matches("visible"));
      const window = windowAt(windows, 0);
      yield* send(actor, { key: meeting.key, type: "Dismiss" });
      yield* TestClock.adjust(before);

      const next = {
        ...meeting,
        key: { ...meeting.key, eventId: "two" },
        title: "Arrived during dismissal",
      };

      yield* send(actor, {
        now,
        preferences,
        snapshot: { events: [next] },
        type: "Input",
      });
      yield* waitFor(
        actor,
        (s) =>
          s.matches("visible") &&
          s.context.visible.some((item) => item.key.eventId === "two")
      );
      expect(
        windows,
        "HIGH arrival must reuse the still-live native handle"
      ).toHaveLength(1);
      expect(
        window.destroyed,
        "HIGH arrival must never show in a destroyed window"
      ).toBe(false);
      yield* TestClock.adjust(400);
      expect(
        window.destroyed,
        "HIGH stale destroy must not destroy the newly arrived prompt"
      ).toBe(false);
      expect(
        actor.getSnapshot().context.visible.map((item) => item.key.eventId),
        "HIGH no arrived prompt may be lost after the old deadline"
      ).toEqual(["two"]);
      expect(latest(window)).toMatchObject({
        value: { events: [{ title: "Arrived during dismissal" }] },
      });
      expect(
        window.sendsAfterDestroy,
        "HIGH no renderer send may target a destroyed handle"
      ).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "shell close during dismissal clears the parent once and stale close cannot clear a replacement",
  () =>
    Effect.gen(function* shellClose() {
      const { native, windows } = nativeFixture();
      let closed = 0;

      const adapter = yield* makePromptWindow(
        () => {},
        () => {
          closed += 1;
        },
        native
      );

      yield* adapter.present([meeting], presentation);
      const old = windowAt(windows, 0);
      yield* Effect.forkChild(adapter.close);
      yield* TestClock.adjust(100);
      old.destroy();
      expect(closed).toBe(1);
      yield* adapter.present(
        [{ ...meeting, title: "Replacement" }],
        presentation
      );
      const replacement = windowAt(windows, 1);
      old.callbacks.get("closed")?.();
      yield* TestClock.adjust(400);
      expect(closed).toBe(1);
      expect(replacement.destroyed).toBe(false);
      expect(latest(replacement)).toMatchObject({
        value: { events: [{ title: "Replacement" }] },
      });
    }).pipe(Effect.scoped)
);

it.effect(
  "actual size IPC expands once, reverts padding, and rejects stale revisions, foreign senders and dismissal reports",
  () =>
    Effect.gen(function* paddingHistory() {
      const { listeners, native, windows } = nativeFixture();

      const adapter = yield* makePromptWindow(
        () => {},
        () => {},
        native
      );

      yield* adapter.present([meeting], presentation);

      const window = windowAt(windows, 0);

      const view = yield* Schema.decodeUnknownEffect(promptWire.view)(
        window.views.at(-1)
      );

      const sender = {
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame,
      };

      const listener = listeners.get(promptChannels.size);

      const padded = yield* Schema.encodeEffect(promptWire.size)({
        height: 250,
        menuPadding: 160,
        revision: view.revision,
      });

      listener?.(sender, padded);
      expect(window.bounds.height).toBe(410);
      listener?.(sender, padded);
      expect(
        window.bounds.height,
        "replayed menu padding must never accumulate"
      ).toBe(410);
      listener?.(
        sender,
        yield* Schema.encodeEffect(promptWire.size)({
          height: 250,
          revision: view.revision,
        })
      );
      expect(
        window.bounds.height,
        "closing the menu restores unpadded measured height"
      ).toBe(250);
      listener?.(
        sender,
        yield* Schema.encodeEffect(promptWire.size)({
          height: 250,
          menuPadding: 160,
          revision: view.revision - 1,
        })
      );
      listener?.({ ...sender, sender: new FakeWindow().webContents }, padded);
      listener?.(
        { ...sender, senderFrame: { ...window.webContents.mainFrame } },
        padded
      );
      expect(
        window.bounds.height,
        "stale revision or untrusted sender cannot resize"
      ).toBe(250);
      yield* Effect.forkChild(adapter.close);
      yield* TestClock.adjust(100);

      const cleared = yield* Schema.decodeUnknownEffect(promptWire.view)(
        window.views.at(-1)
      );

      listener?.(
        sender,
        yield* Schema.encodeEffect(promptWire.size)({
          height: 800,
          menuPadding: 160,
          revision: cleared.revision,
        })
      );
      expect(
        window.bounds.height,
        "dismissing content cannot expand the retained native handle"
      ).toBe(250);
      yield* TestClock.adjust(100);
      expect(window.destroyed).toBe(true);
      expect(windows).toHaveLength(1);
    }).pipe(Effect.scoped)
);

it.effect(
  "quit destroys immediately during dismissal and forbids every later create or reveal",
  () =>
    Effect.gen(function* quitHistory() {
      const { native, windows } = nativeFixture();
      const scope = yield* Scope.make();

      const adapter = yield* makePromptWindow(
        () => {},
        () => {},
        native
      ).pipe(Scope.provide(scope));

      yield* adapter.present([meeting], presentation);
      const window = windowAt(windows, 0);
      yield* Effect.forkChild(adapter.close);
      yield* TestClock.adjust(100);
      yield* Scope.close(scope, Exit.void);
      expect(window.destroys).toBe(1);

      const late = yield* Effect.result(
        adapter.present([meeting], presentation)
      );

      expect(late._tag).toBe("Failure");
      yield* TestClock.adjust(400);
      expect(windows).toHaveLength(1);
      expect(window.destroys).toBe(1);
      expect(window.sendsAfterDestroy).toBe(0);
    }).pipe(Effect.scoped)
);
