import { expect, it } from "@effect/vitest";
import {
  Effect,
  Exit,
  Option,
  Predicate,
  Queue,
  Schema,
  Scope,
  Stream,
} from "effect";
import { vi } from "vitest";

import { Message, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { RemoteEvents, eventKey } from "../src/client/calendar-state.js";
import { EditorRequest } from "../src/client/editing/editor-session-model.js";
import { gestureMountFor } from "../src/client/editing/gesture-mount.js";
import { gestureSubscriptions } from "../src/client/editing/gesture-subscription.js";
import {
  gestureTargetRegistry,
  modelGestureInputs,
} from "../src/client/editing/gesture-targets.js";
import { EditingCommand } from "../src/client/editing/runtime.js";
import { completeGesture } from "../src/client/editing/update.js";
import { TimeZoneAction } from "../src/client/time-zones/model.js";
import { visibleDays } from "../src/layout/navigation.js";
import { primarySelection } from "../src/layout/selection-set.js";
import { displayZone } from "../src/layout/time-zones.js";
import { fixtureEvents } from "./fixture.js";
import { keyboardFixture } from "./keyboard-fixture.js";

const openedScope = Effect.acquireRelease(Scope.make(), (scope) =>
  Scope.close(scope, Exit.void)
);

const takeTargetPrepared = (messages: Queue.Queue<AppMessage>) =>
  Stream.fromQueue(messages).pipe(
    Stream.filter((message) =>
      Predicate.isTagged(message, "PreparedGestureTargets")
    ),
    Stream.runHead
  );

const takePrepared = Effect.fn("waitForGestureInputs")(function* takePrepared(
  messages: Queue.Queue<AppMessage>
) {
  const ready = new Set<string>();

  while (ready.size < 2) {
    const message = yield* Queue.take(messages);

    if (Predicate.isTagged(message, "PreparedGestureHost")) {
      ready.add("host");
    }

    if (Predicate.isTagged(message, "PreparedGestureTargets")) {
      ready.add("targets");
    }
  }
});

const takeArmed = (messages: Queue.Queue<AppMessage>) =>
  Stream.fromQueue(messages).pipe(
    Stream.filter((message) => Predicate.isTagged(message, "PreviewedGesture")),
    Stream.filter((message) => message.phase === "armed"),
    Stream.runHead
  );

const takePreview = (messages: Queue.Queue<AppMessage>) =>
  Stream.fromQueue(messages).pipe(
    Stream.filter((message) => Predicate.isTagged(message, "PreviewedGesture")),
    Stream.filter((message) => Option.isSome(message.preview)),
    Stream.runHead
  );

const takeCompleted = (messages: Queue.Queue<AppMessage>) =>
  Stream.fromQueue(messages).pipe(
    Stream.filter((message) => Predicate.isTagged(message, "CompletedGesture")),
    Stream.runHead,
    Effect.flatMap((value) =>
      Effect.fromNullishOr(Option.getOrUndefined(value))
    )
  );

const hostFor = Effect.fn("gestureTestHost")(function* hostFor(
  model: AppModel
) {
  return yield* Effect.acquireRelease(
    Effect.sync(() => {
      const host = document.createElement("div");
      host.id = "gesture-host";
      host.dataset.gestureHostKey = Option.getOrThrow(
        modelGestureInputs(model).key
      );
      const viewport = document.createElement("div");
      viewport.id = "time-viewport";
      viewport.getBoundingClientRect = () => new DOMRect(0, 0, 700, 1152);

      for (const [index, day] of visibleDays(
        model.calendar.navigation
      ).entries()) {
        const column = document.createElement("div");
        column.className = "day-column";
        column.dataset.day = String(day);
        column.getBoundingClientRect = () =>
          new DOMRect(index * 100, 0, 100, 1152);
        viewport.append(column);
      }

      host.append(viewport);
      document.body.append(host);

      return host;
    }),
    (host) =>
      Effect.sync(() => {
        host.remove();
      })
  );
});

const putChip = (host: HTMLElement, model: AppModel): HTMLElement => {
  const selected = Option.getOrThrow(primarySelection(model.calendar.selected));

  const target = modelGestureInputs(model).targets.find(
    (entry) => entry.key === selected
  );

  if (target === undefined) {
    throw new Error("Expected current target");
  }

  const column = host.querySelector<HTMLElement>(
    `.day-column[data-day='${Math.floor(target.start / 1440)}']`
  );

  if (column === null) {
    throw new Error("Expected target column");
  }

  const chip = document.createElement("button");
  chip.className = "event-chip selected";
  chip.dataset.eventKey = selected;
  column.append(chip);

  return chip;
};

const point = (
  host: HTMLElement,
  chip: HTMLElement,
  type: string,
  minute: number
) => {
  if (!host.contains(chip)) {
    throw new Error("Pointer target is outside its host");
  }

  const column = chip.closest<HTMLElement>(".day-column");

  if (column === null) {
    throw new Error("Expected column");
  }

  const event = new PointerEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: column.getBoundingClientRect().left + 50,
    clientY: (minute * 48) / 60,
    isPrimary: true,
    pointerId: 1,
  });

  (type === "pointerdown" ? chip : window).dispatchEvent(event);
};

it.effect(
  "live dependency targets arrive after mount and remain current through an active drag without a restart",
  () =>
    Effect.gen(function* liveGetter() {
      const loaded = keyboardFixture();

      let current: AppModel = {
        ...loaded,
        calendar: {
          ...loaded.calendar,
          reads: loaded.calendar.reads.map((read) => ({
            ...read,
            events: RemoteEvents.Loading(),
          })),
        },
      };

      const registry = gestureTargetRegistry();
      const host = yield* hostFor(current);
      const messages = yield* Queue.unbounded<AppMessage>();
      const mounted = yield* openedScope;
      const subscribed = yield* openedScope;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.stubGlobal(
            "requestAnimationFrame",
            (onFrame: FrameRequestCallback) => {
              onFrame(0);

              return 1;
            }
          )
        ),
        () => Effect.sync(() => vi.unstubAllGlobals())
      );
      const key = Option.getOrThrow(modelGestureInputs(current).key);

      const mount = gestureMountFor(registry)({
        hostKey: key,
        personId: Option.getOrThrow(current.person),
        scale: 48,
      });

      yield* mount.f(host, Stream.empty).pipe(
        Stream.runForEach((message) => Queue.offer(messages, message)),
        Effect.forkIn(mounted)
      );
      const subscription = gestureSubscriptions(registry).gestureTargets;
      yield* subscription
        .dependenciesToStream(subscription.modelToDependencies(current), () =>
          subscription.modelToDependencies(current)
        )
        .pipe(
          Stream.runForEach((message) => Queue.offer(messages, message)),
          Effect.forkIn(subscribed)
        );
      yield* takePrepared(messages);
      expect(registry.count()).toBe(1);
      expect(registry.read(key, host)).toHaveLength(0);
      const before = subscription.modelToDependencies(current);
      current = loaded;
      expect(
        subscription.keepAliveEquivalence(
          before,
          subscription.modelToDependencies(current)
        )
      ).toBe(true);
      expect(registry.read(key, host)?.length).toBeGreaterThan(0);
      const chip = putChip(host, current);
      point(host, chip, "pointerdown", 540);
      yield* takeArmed(messages);
      point(host, chip, "pointermove", 600);
      yield* takePreview(messages);

      const selected = Option.getOrThrow(
        primarySelection(current.calendar.selected)
      );

      current = {
        ...current,
        calendar: {
          ...current.calendar,
          reads: current.calendar.reads.map((read) =>
            read.accountId === "work"
              ? {
                  ...read,
                  events: RemoteEvents.Success({
                    data: {
                      events: fixtureEvents
                        .filter((event) => event.accountId === "work")
                        .map((event) =>
                          eventKey(event) === selected
                            ? {
                                ...event,
                                guestsCanModify: true,
                                title: "Live title at drop",
                              }
                            : event
                        ),
                      versions: [],
                    },
                  }),
                }
              : read
          ),
        },
      };
      expect(
        registry.read(key, host)?.find((target) => target.key === selected)
          ?.event.title
      ).toBe("Live title at drop");
      point(host, chip, "pointerup", 660);
      const completed = yield* takeCompleted(messages);
      const result = completeGesture(current, completed.gesture);

      const command = result.commands?.find(
        (entry) => entry.name === "DispatchEditing"
      )?.args?.command;

      const decoded =
        yield* Schema.decodeUnknownEffect(EditingCommand)(command);

      expect(EditingCommand.guards.Open(decoded)).toBe(true);

      if (
        EditingCommand.guards.Open(decoded) &&
        EditorRequest.guards.Existing(decoded.request)
      ) {
        expect(decoded.request).toMatchObject({
          event: { title: "Live title at drop" },
          range: { endTime: "12:00", startTime: "11:00" },
        });
      }

      yield* Scope.close(mounted, Exit.void);
      expect(registry.count()).toBe(0);
      yield* Scope.close(subscribed, Exit.void);
      expect(registry.count()).toBe(0);
    })
);

it.effect(
  "a mounted gesture without a registered live getter refuses input instead of using captured targets",
  () =>
    Effect.gen(function* missingGetter() {
      const model = keyboardFixture();
      const registry = gestureTargetRegistry();
      const host = yield* hostFor(model);
      const messages = yield* Queue.unbounded<AppMessage>();
      const mounted = yield* openedScope;
      const key = Option.getOrThrow(modelGestureInputs(model).key);
      yield* gestureMountFor(registry)({
        hostKey: key,
        personId: Option.getOrThrow(model.person),
        scale: 48,
      })
        .f(host, Stream.empty)
        .pipe(
          Stream.runForEach((message) => Queue.offer(messages, message)),
          Effect.forkIn(mounted)
        );
      yield* Stream.fromQueue(messages).pipe(
        Stream.filter((message) =>
          Predicate.isTagged(message, "PreparedGestureHost")
        ),
        Stream.runHead
      );
      const chip = putChip(host, model);
      point(host, chip, "pointerdown", 540);
      point(host, chip, "pointermove", 600);
      point(host, chip, "pointerup", 660);
      yield* Effect.yieldNow;
      expect(Option.isNone(yield* Queue.poll(messages))).toBe(true);
      expect(registry.count()).toBe(0);
      yield* Scope.close(mounted, Exit.void);
      expect(registry.count()).toBe(0);
    })
);

it.effect(
  "person sign-out changes the subscription key and clears the scoped getter",
  () =>
    Effect.gen(function* signedOutGetter() {
      let current = keyboardFixture();
      const host = yield* hostFor(current);
      const registry = gestureTargetRegistry();
      const key = Option.getOrThrow(modelGestureInputs(current).key);
      const messages = yield* Queue.unbounded<AppMessage>();
      const subscribed = yield* openedScope;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.stubGlobal(
            "requestAnimationFrame",
            (onFrame: FrameRequestCallback) => {
              onFrame(0);

              return 1;
            }
          )
        ),
        () => Effect.sync(() => vi.unstubAllGlobals())
      );
      const entry = gestureSubscriptions(registry).gestureTargets;
      const before = entry.modelToDependencies(current);
      yield* entry
        .dependenciesToStream(before, () => entry.modelToDependencies(current))
        .pipe(
          Stream.runForEach((message) => Queue.offer(messages, message)),
          Effect.forkIn(subscribed)
        );
      yield* takeTargetPrepared(messages);
      expect(registry.count()).toBe(1);
      current = update(
        current,
        Message.ReceivedSession({ snapshot: null })
      ).model;
      const after = entry.modelToDependencies(current);
      expect(entry.keepAliveEquivalence(before, after)).toBe(false);
      expect(registry.read(key, host)).toBeUndefined();
      yield* Scope.close(subscribed, Exit.void);
      yield* entry
        .dependenciesToStream(after, () => after)
        .pipe(Stream.runDrain);
      expect(registry.count()).toBe(0);
      expect(registry.read(key, host)).toBeUndefined();
    })
);

it.effect(
  "entering and leaving travel changes the host lease and gives the real actor correct current-zone previews",
  () =>
    Effect.gen(function* travelMounts() {
      const base = keyboardFixture();
      const registry = gestureTargetRegistry();
      let current = base;
      let previousKey = Option.getOrThrow(modelGestureInputs(base).key);
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.stubGlobal(
            "requestAnimationFrame",
            (onFrame: FrameRequestCallback) => {
              onFrame(0);

              return 1;
            }
          )
        ),
        () => Effect.sync(() => vi.unstubAllGlobals())
      );

      for (const travel of [true, false]) {
        const action = travel
          ? TimeZoneAction.cases.Travel.make({
              zone: displayZone("Asia/Tokyo"),
            })
          : TimeZoneAction.cases.Home.make({});

        const moved = update(current, Message.TimeZoneAction({ action })).model;
        current = {
          ...moved,
          calendar: { ...moved.calendar, reads: base.calendar.reads },
        };
        const inputs = modelGestureInputs(current);
        const key = Option.getOrThrow(inputs.key);
        expect(key).not.toBe(previousKey);
        previousKey = key;
        const host = yield* hostFor(current);
        const messages = yield* Queue.unbounded<AppMessage>();
        const mounted = yield* openedScope;
        const subscribed = yield* openedScope;

        const mount = gestureMountFor(registry)({
          hostKey: key,
          personId: Option.getOrThrow(current.person),
          scale: 48,
        });

        yield* mount.f(host, Stream.empty).pipe(
          Stream.runForEach((message) => Queue.offer(messages, message)),
          Effect.forkIn(mounted)
        );
        const subscription = gestureSubscriptions(registry).gestureTargets;
        const dependencies = subscription.modelToDependencies(current);
        yield* subscription
          .dependenciesToStream(dependencies, () => dependencies)
          .pipe(
            Stream.runForEach((message) => Queue.offer(messages, message)),
            Effect.forkIn(subscribed)
          );
        yield* takePrepared(messages);

        const selected = Option.getOrThrow(
          primarySelection(current.calendar.selected)
        );

        const target = yield* Effect.fromNullishOr(
          inputs.targets.find((entry) => entry.key === selected)
        );

        const start = target.start % 1440;
        const chip = putChip(host, current);
        point(host, chip, "pointerdown", start);
        yield* takeArmed(messages);
        point(host, chip, "pointermove", start + 60);
        const preview = yield* takePreview(messages);
        expect(Option.getOrUndefined(preview)?.preview).toMatchObject(
          Option.some({ range: { startTime: travel ? "02:00" : "10:00" } })
        );
        point(host, chip, "pointerup", start + 120);
        const completed = yield* takeCompleted(messages);
        expect(completed.gesture.range).toMatchObject({
          endTime: travel ? "04:00" : "12:00",
          startDate: travel ? "2026-10-20" : "2026-10-19",
          startTime: travel ? "03:00" : "11:00",
        });
        yield* Scope.close(mounted, Exit.void);
        expect(registry.count()).toBe(0);
        yield* Scope.close(subscribed, Exit.void);
        host.remove();
      }
    })
);
