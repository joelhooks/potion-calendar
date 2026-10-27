import { pathToFileURL } from "node:url";

import {
  defaultDesktopPreferences,
  promptChannels,
  PromptSoundRequest,
  promptWire,
} from "@calendar/core/desktop-bridge";
import type { AgendaEventValue } from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import type { EffectActor } from "@xstate/effect";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Predicate,
  Ref,
  Schema,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";

import { DesktopError } from "../src/config.js";
import { startPrompt } from "../src/prompt-machine.js";
import type { promptMachine } from "../src/prompt-machine.js";
import {
  promptDismissalIntervalMs,
  startPromptWindowLifecycle,
} from "../src/prompt-window-lifecycle.js";
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
  sounds: string[] = [];
  soundStarted: Deferred.Deferred<string> | undefined;
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

      if (channel === promptChannels.sound) {
        this.sounds.push(value);

        if (this.soundStarted !== undefined) {
          Deferred.doneUnsafe(this.soundStarted, Effect.succeed(value));
        }
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

const nativeFixture = (soundStarted?: Deferred.Deferred<string>) => {
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
      window.soundStarted = soundStarted;
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

const reportSoundReady = Effect.fn("Test.reportSoundReady")(
  function* reportSoundReady(
    listeners: ReturnType<typeof nativeFixture>["listeners"],
    window: FakeWindow,
    request: number
  ) {
    const reply = yield* Schema.encodeEffect(promptWire.soundReply)({
      phase: "load",
      ready: true,
      request,
    });

    yield* Effect.sync(() => {
      listeners.get(promptChannels.soundReply)?.(
        {
          sender: window.webContents,
          senderFrame: window.webContents.mainFrame,
        },
        reply
      );
    });
  }
);

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

it.effect.prop(
  "HIGH rejected preview during dismissal cannot supersede the original destruction deadline",
  {
    before: Schema.Int.check(Schema.isBetween({ maximum: 199, minimum: 0 })),
    kind: Schema.Literals(["none", "disabled", "retained"]),
  },
  ({ before, kind }) =>
    Effect.gen(function* rejectedPreviewHistory() {
      const { native, windows } = nativeFixture();

      const adapter = yield* makePromptWindow(
        () => {},
        () => {},
        native
      );

      yield* adapter.present([meeting], presentation);
      const window = windowAt(windows, 0);

      yield* Effect.forkChild(adapter.close);
      yield* TestClock.adjust(before);
      const views = window.views.length;
      const sounds = window.sounds.length;

      expect(
        yield* adapter.preview(
          kind === "none" ? "none" : "bell",
          Effect.succeed(kind !== "disabled")
        )
      ).toBe(false);
      expect(window.views).toHaveLength(views);
      expect(window.sounds).toHaveLength(sounds);
      yield* TestClock.adjust(promptDismissalIntervalMs - before);
      expect(
        window.destroys,
        "HIGH rejected preview must preserve the original dismissal deadline"
      ).toBe(1);
      expect(windows).toHaveLength(1);
      expect(window.sendsAfterDestroy).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "HIGH preview during in-flight content presentation cannot supersede its actor or content",
  { enabled: Schema.Boolean, sound: Schema.Literals(["none", "bell"]) },
  ({ sound, enabled }) =>
    Effect.gen(function* presentationPreviewHistory() {
      const started = yield* Deferred.make<string>();
      const { native, windows, listeners } = nativeFixture(started);

      const adapter = yield* makePromptWindow(
        () => {},
        () => {},
        native
      );

      const pending = yield* Effect.forkChild(
        adapter.present([meeting], { ...presentation, sound: "bell" })
      );

      const request = yield* Schema.decodeEffect(promptWire.sound)(
        yield* Deferred.await(started)
      );

      const window = windowAt(windows, 0);

      expect(request._tag).toBe("Load");

      const attempt = yield* Effect.forkChild(
        adapter.preview(sound, Effect.succeed(enabled))
      );

      yield* TestClock.adjust(0);
      const rejection = yield* Effect.sync(() => attempt.pollUnsafe());

      expect(
        rejection,
        "HIGH busy preview must reject without starting or awaiting sound work"
      ).toEqual(Exit.succeed(false));
      expect(window.sounds).toHaveLength(1);
      yield* reportSoundReady(listeners, window, request.request);
      yield* TestClock.adjust(0);
      const completion = yield* Effect.sync(() => pending.pollUnsafe());

      expect(
        completion?._tag,
        "HIGH preview must not interrupt or strand the in-flight presentation"
      ).toBe("Success");
      expect(latest(window)).toMatchObject({ value: { events: [meeting] } });
      expect(window.visible).toBe(true);
      expect(window.destroys).toBe(0);
      expect(windows).toHaveLength(1);
      expect(window.sendsAfterDestroy).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "eligible sound preview preserves its tone and rechecks eligibility after real loading without presenting content",
  { allowed: Schema.Boolean, sound: Schema.Literals(["blip", "bell", "tap"]) },
  ({ sound, allowed }) =>
    Effect.gen(function* eligiblePreviewHistory() {
      const started = yield* Deferred.make<string>();
      const enabled = yield* Ref.make(true);
      const { native, windows, listeners } = nativeFixture(started);

      const adapter = yield* makePromptWindow(
        () => {},
        () => {},
        native
      );

      const pending = yield* Effect.forkChild(
        adapter.preview(sound, Ref.get(enabled))
      );

      const request = yield* Schema.decodeEffect(promptWire.sound)(
        yield* Deferred.await(started)
      );

      const window = windowAt(windows, 0);
      expect(request).toEqual(
        PromptSoundRequest.cases.Load.make({ request: request.request, sound })
      );
      yield* Ref.set(enabled, allowed);
      yield* reportSoundReady(listeners, window, request.request);
      yield* TestClock.adjust(0);
      const completion = yield* Effect.sync(() => pending.pollUnsafe());

      expect(
        completion,
        "preview returns the current eligibility result after native sound loading"
      ).toEqual(Exit.succeed(allowed));

      const requests = yield* Effect.forEach((raw: string) =>
        Schema.decodeEffect(promptWire.sound)(raw)
      )(window.sounds);

      expect(requests.filter(Predicate.isTagged("Play"))).toEqual(
        allowed
          ? [
              PromptSoundRequest.cases.Play.make({
                request: request.request,
                sound,
              }),
            ]
          : []
      );
      expect(requests.at(-1)?._tag).toBe("Cancel");
      expect(window.views).toHaveLength(0);
      expect(window.visible).toBe(false);
      expect(windows).toHaveLength(1);
      expect(window.sendsAfterDestroy).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "content presentation and quit preempt a sound preview with a settled false result and no late sound work",
  { by: Schema.Literals(["content", "quit"]) },
  ({ by }) =>
    Effect.gen(function* previewPreemptionHistory() {
      const started = yield* Deferred.make<string>();
      const { native, windows, listeners } = nativeFixture(started);
      const scope = yield* Scope.make();

      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));

      const adapter = yield* makePromptWindow(
        () => {},
        () => {},
        native
      ).pipe(Scope.provide(scope));

      const pending = yield* Effect.forkChild(
        adapter.preview("bell", Effect.succeed(true))
      );

      const request = yield* Schema.decodeEffect(promptWire.sound)(
        yield* Deferred.await(started)
      );

      const window = windowAt(windows, 0);

      if (by === "content") {
        yield* adapter.present([meeting], presentation);
        expect(latest(window)).toMatchObject({ value: { events: [meeting] } });
        expect(window.visible).toBe(true);
        expect(window.destroys).toBe(0);
      } else {
        yield* Scope.close(scope, Exit.void);
        expect(window.destroys).toBe(1);

        const lateCaller = yield* Effect.forkChild(
          adapter.preview("bell", Effect.succeed(true))
        );

        yield* TestClock.adjust(0);
        const late = yield* Effect.sync(() => lateCaller.pollUnsafe());

        expect(
          late,
          "quit rejects late preview without native preparation"
        ).toEqual(Exit.succeed(false));
      }

      yield* reportSoundReady(listeners, window, request.request);
      yield* TestClock.adjust(0);
      const completion = yield* Effect.sync(() => pending.pollUnsafe());

      expect(
        completion,
        "content or quit settles the preempted preview as false"
      ).toEqual(Exit.succeed(false));

      const requests = yield* Effect.forEach((raw: string) =>
        Schema.decodeEffect(promptWire.sound)(raw)
      )(window.sounds);

      expect(requests.filter(Predicate.isTagged("Play"))).toHaveLength(0);
      expect(windows).toHaveLength(1);
      expect(window.sendsAfterDestroy).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "none and disabled previews create no window and do not affect the next real presentation",
  { sound: Schema.Literals(["none", "bell"]) },
  ({ sound }) =>
    Effect.gen(function* noOpPreviewHistory() {
      const { native, windows } = nativeFixture();

      const adapter = yield* makePromptWindow(
        () => {},
        () => {},
        native
      );

      expect(yield* adapter.preview(sound, Effect.succeed(false))).toBe(false);
      expect(windows).toHaveLength(0);
      yield* adapter.present([meeting], presentation);
      expect(latest(windowAt(windows, 0))).toMatchObject({
        value: { events: [meeting] },
      });
      expect(windows).toHaveLength(1);
      expect(windowAt(windows, 0).visible).toBe(true);
    }).pipe(Effect.scoped)
);

it.effect(
  "HIGH preview caller settles false when Present is queued before snapshot publication",
  () =>
    Effect.gen(function* queuedPresentPreview() {
      const lifecycle = yield* startPromptWindowLifecycle();
      const release = yield* Deferred.make<boolean>();
      const previewRuns = yield* Ref.make(0);

      const pending = yield* Effect.forkChild(
        Effect.gen(function* submitBehindPresent() {
          yield* send(lifecycle.actor, {
            job: { work: Deferred.await(release).pipe(Effect.asVoid) },
            type: "Present",
          });

          const unpublished = yield* Effect.sync(() =>
            lifecycle.actor.getSnapshot().matches("destroyed")
          );

          expect(
            unpublished,
            "the real queued Present has not yet published a busy snapshot"
          ).toBe(true);

          return yield* lifecycle.preview(
            Ref.update(previewRuns, (value) => value + 1).pipe(Effect.as(true))
          );
        })
      );

      yield* TestClock.adjust(0);
      const completion = yield* Effect.sync(() => pending.pollUnsafe());

      expect(
        completion,
        "HIGH queued Present cannot leave its following preview caller pending"
      ).toEqual(Exit.succeed(false));
      expect(yield* Ref.get(previewRuns)).toBe(0);
      yield* Deferred.succeed(release, true);
      yield* TestClock.adjust(0);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "two previews queued before publication admit one work item and settle both callers",
  { firstResult: Schema.Boolean },
  ({ firstResult }) =>
    Effect.gen(function* concurrentPreviewRequests() {
      const lifecycle = yield* startPromptWindowLifecycle();
      const release = yield* Deferred.make<boolean>();
      const first = yield* Deferred.make<boolean, DesktopError>();
      const second = yield* Deferred.make<boolean, DesktopError>();
      const firstRuns = yield* Ref.make(0);
      const secondRuns = yield* Ref.make(0);
      const firstCaller = yield* Effect.forkChild(Deferred.await(first));
      const secondCaller = yield* Effect.forkChild(Deferred.await(second));

      const firstRequest = {
        job: {
          work: Deferred.complete(
            first,
            Ref.update(firstRuns, (value) => value + 1).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(firstResult)
            )
          ).pipe(Effect.asVoid),
        },
        result: first,
        type: Schema.Literal("Preview").make("Preview"),
      };

      const secondRequest = {
        job: {
          work: Deferred.complete(
            second,
            Ref.update(secondRuns, (value) => value + 1).pipe(Effect.as(true))
          ).pipe(Effect.asVoid),
        },
        result: second,
        type: Schema.Literal("Preview").make("Preview"),
      };

      const unpublished = yield* Effect.sync(() => {
        lifecycle.actor.send(firstRequest);
        lifecycle.actor.send(secondRequest);

        return lifecycle.actor.getSnapshot().matches("destroyed");
      });

      expect(
        unpublished,
        "both real Preview events are queued before the published state changes"
      ).toBe(true);
      yield* TestClock.adjust(0);
      const rejected = yield* Effect.sync(() => secondCaller.pollUnsafe());

      expect(
        rejected,
        "HIGH the second queued preview caller must settle false without starting work"
      ).toEqual(Exit.succeed(false));
      expect(yield* Ref.get(firstRuns)).toBe(1);
      expect(yield* Ref.get(secondRuns)).toBe(0);
      yield* Deferred.succeed(release, true);
      yield* TestClock.adjust(0);
      const completed = yield* Effect.sync(() => firstCaller.pollUnsafe());

      expect(
        completed,
        "the admitted caller completes with its own result"
      ).toEqual(Exit.succeed(firstResult));
      expect(yield* Ref.get(firstRuns)).toBe(1);
      expect(yield* Ref.get(secondRuns)).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "HIGH preview caller settles false after lifecycle completion or scope stop",
  { terminal: Schema.Literals(["quit", "stop"]) },
  ({ terminal }) =>
    Effect.gen(function* terminalPreviewRequest() {
      const serviceScope = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(serviceScope, Exit.void));

      const lifecycle = yield* startPromptWindowLifecycle().pipe(
        Effect.provideService(Scope.Scope, serviceScope)
      );

      const previewRuns = yield* Ref.make(0);

      if (terminal === "quit") {
        yield* lifecycle.perform("Quit", Effect.succeed(true));
        yield* waitFor(lifecycle.actor, (snapshot) => snapshot.matches("quit"));
      } else {
        yield* Scope.close(serviceScope, Exit.void);
      }

      const pending = yield* Effect.forkChild(
        lifecycle.preview(
          Ref.update(previewRuns, (value) => value + 1).pipe(Effect.as(true))
        )
      );

      yield* TestClock.adjust(0);
      const completion = yield* Effect.sync(() => pending.pollUnsafe());

      expect(
        completion,
        "HIGH a terminal lifecycle cannot leave a preview caller pending"
      ).toEqual(Exit.succeed(false));
      expect(yield* Ref.get(previewRuns)).toBe(0);
    }).pipe(Effect.scoped)
);

it.effect(
  "Quit queued before snapshot publication rejects its following preview without work",
  () =>
    Effect.gen(function* queuedQuitPreview() {
      const lifecycle = yield* startPromptWindowLifecycle();
      const previewRuns = yield* Ref.make(0);

      const pending = yield* Effect.forkChild(
        Effect.gen(function* submitBehindQuit() {
          yield* send(lifecycle.actor, {
            job: { work: Effect.void },
            type: "Quit",
          });

          const unpublished = yield* Effect.sync(() =>
            lifecycle.actor.getSnapshot().matches("destroyed")
          );

          expect(unpublished).toBe(true);

          return yield* lifecycle.preview(
            Ref.update(previewRuns, (value) => value + 1).pipe(Effect.as(true))
          );
        })
      );

      yield* TestClock.adjust(0);
      const completion = yield* Effect.sync(() => pending.pollUnsafe());

      expect(
        completion,
        "a queued Quit settles the following preview false before any native work"
      ).toEqual(Exit.succeed(false));
      expect(yield* Ref.get(previewRuns)).toBe(0);
      expect(lifecycle.actor.getSnapshot().matches("quit")).toBe(true);
    }).pipe(Effect.scoped)
);

it.effect.prop(
  "busy preview settlement never waits for the caller before content and quit proceed",
  { busy: Schema.Literals(["Present", "Dismiss"]) },
  ({ busy }) =>
    Effect.gen(function* priorityThroughBusyRejection() {
      const lifecycle = yield* startPromptWindowLifecycle();
      const releaseWork = yield* Deferred.make<boolean>();
      const releaseCaller = yield* Deferred.make<boolean>();
      const delivered = yield* Ref.make(Option.none<boolean>());
      const previewRuns = yield* Ref.make(0);
      const presentRuns = yield* Ref.make(0);
      yield* send(lifecycle.actor, {
        job: { work: Deferred.await(releaseWork).pipe(Effect.asVoid) },
        type: busy,
      });
      yield* waitFor(lifecycle.actor, (snapshot) =>
        busy === "Present"
          ? snapshot.matches("presenting")
          : snapshot.matches("dismissing")
      );

      const caller = yield* Effect.forkChild(
        lifecycle
          .preview(
            Ref.update(previewRuns, (value) => value + 1).pipe(Effect.as(true))
          )
          .pipe(
            Effect.tap((value) => Ref.set(delivered, Option.some(value))),
            Effect.andThen(Deferred.await(releaseCaller))
          )
      );

      yield* TestClock.adjust(0);

      expect(
        yield* Ref.get(delivered),
        "busy rejection delivers false even while its client continuation waits"
      ).toEqual(Option.some(false));

      const present = yield* Effect.forkChild(
        lifecycle.perform(
          "Present",
          Ref.updateAndGet(presentRuns, (value) => value + 1)
        )
      );

      yield* TestClock.adjust(0);
      const presentationResult = yield* Effect.sync(() => present.pollUnsafe());

      expect(
        presentationResult,
        "content never waits for the rejected client"
      ).toEqual(Exit.succeed(1));

      const quit = yield* Effect.forkChild(
        lifecycle.perform("Quit", Effect.succeed(true))
      );

      yield* TestClock.adjust(0);
      const completion = yield* Effect.sync(() => quit.pollUnsafe());

      expect(completion, "quit never waits for the rejected client").toEqual(
        Exit.succeed(true)
      );
      expect(yield* Ref.get(previewRuns)).toBe(0);
      expect(yield* Ref.get(presentRuns)).toBe(1);
      yield* Deferred.succeed(releaseCaller, true);
      yield* TestClock.adjust(0);
      const resumed = yield* Effect.sync(() => caller.pollUnsafe());

      expect(resumed).toEqual(Exit.succeed(true));
    }).pipe(Effect.scoped)
);

it.effect("accepted preview retains its genuine typed work failure", () =>
  Effect.gen(function* previewFailure() {
    const lifecycle = yield* startPromptWindowLifecycle();
    const failure = new DesktopError({ message: "Native sound load failed" });

    const pending = yield* Effect.forkChild(
      lifecycle.preview(Effect.fail(failure))
    );

    yield* TestClock.adjust(0);
    const completion = yield* Effect.sync(() => pending.pollUnsafe());

    expect(
      Option.fromUndefinedOr(completion).pipe(
        Option.flatMap(Exit.findErrorOption)
      )
    ).toEqual(Option.some(failure));
  }).pipe(Effect.scoped)
);
