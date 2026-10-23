import { ActorWatch } from "@calendar/capability/actor-watch";
import type { ActorWatchService } from "@calendar/capability/actor-watch";
import {
  Clock,
  Effect,
  Option,
  Predicate,
  Queue,
  Schema,
  Stream,
} from "effect";
import { Runtime, Subscription } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { vi } from "vitest";

import { Model, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { gestureMountFor } from "../src/client/editing/gesture-mount.js";
import {
  gestureTargetRegistry,
  modelGestureInputs,
} from "../src/client/editing/gesture-targets.js";
import { timeGrid } from "../src/features/time-grid.js";
import { unusedBrowserLayers } from "./browser-runtime-fixture.js";
import { phoneGridFixture, phoneGridScenes } from "./phone-grid-fixture.js";

export const phonePointer = (
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  pointerType = "touch",
  pointerId = 1,
  isPrimary = true
) => {
  const event = new PointerEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: x,
    clientY: y,
    isPrimary,
    pointerId,
    pointerType,
  });

  target.dispatchEvent(event);

  return event;
};

export const phoneDom = (read: () => boolean) =>
  Effect.callback<boolean>((resume) => {
    const check = () => {
      if (read()) {
        resume(Effect.succeed(true));
      }
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    check();

    return Effect.sync(() => {
      observer.disconnect();
    });
  });

export const mountPhoneGrid = Effect.fn("mountPhoneGrid")(
  function* mountPhoneGrid(
    clock?: Clock.Clock,
    initial: AppModel = phoneGridFixture(phoneGridScenes[0]),
    watcher?: ActorWatchService
  ) {
    let current = initial;
    const commands: string[] = [];
    const messages = yield* Queue.unbounded<AppMessage>();
    const inbound = yield* Queue.unbounded<AppMessage>();
    const captures = new Set<number>();
    const transfers: number[] = [];
    const registry = gestureTargetRegistry();
    const prepare = gestureMountFor(registry);

    const container = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const element = document.createElement("div");
        element.id = "phone-grid-runtime";
        document.body.append(element);
        vi.stubGlobal(
          "ResizeObserver",
          class {
            observe = vi.fn();
            unobserve = vi.fn();
            disconnect = vi.fn();
          }
        );
        vi.stubGlobal("matchMedia", () => ({
          addEventListener: vi.fn(),
          matches: true,
          removeEventListener: vi.fn(),
        }));

        return element;
      }),
      (element) =>
        Effect.sync(() => {
          document.querySelector("#phone-grid-runtime")?.remove();
          element.remove();
          vi.unstubAllGlobals();
        })
    );

    const program = Runtime.makeElement({
      Model,
      container,
      devTools: false,
      init: () => ({ model: current }),
      resources: unusedBrowserLayers,
      subscriptions: Subscription.make<AppModel, AppMessage>()(() => ({
        input: Subscription.persistentEntry(Stream.fromQueue(inbound)),
      })),
      update: (model, message) => {
        const result = update(model, message);
        current = result.model;
        commands.push(
          ...(result.commands ?? []).map((command) => command.name)
        );
        Queue.offerUnsafe(messages, message);

        return { model: result.model };
      },
      view: (model: AppModel, h: HtmlBuilder<AppMessage>) =>
        h.div([h.Id("phone-grid-runtime")], [timeGrid(model, h, prepare)]),
    });

    const watchedStart =
      watcher === undefined
        ? program.start()
        : program.start().pipe(Effect.provideService(ActorWatch, watcher));

    const timedStart =
      clock === undefined
        ? watchedStart
        : watchedStart.pipe(Effect.provideService(Clock.Clock, clock));

    yield* timedStart.pipe(Effect.forkScoped);

    const notice = (tag: AppMessage["_tag"]) =>
      Stream.fromQueue(messages).pipe(
        Stream.filter((message) => Predicate.isTagged(message, tag)),
        Stream.runHead,
        Effect.map(Option.getOrThrow)
      );

    yield* notice("PreparedGestureHost");

    const root = yield* Effect.fromNullishOr(
      document.querySelector<HTMLElement>("#gesture-host")
    );

    const key = yield* Schema.decodeUnknownEffect(Schema.String)(
      root.dataset.gestureHostKey
    );

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        registry.register(key, root, () => modelGestureInputs(current).targets)
      ),
      (release) => Effect.sync(release)
    );
    root.setPointerCapture = (id) => {
      captures.add(id);

      if (
        root.dataset.touchPhase === "swiping" ||
        root.dataset.touchPhase === "held"
      ) {
        transfers.push(id);
        root.querySelector(".day-column")?.dispatchEvent(
          new PointerEvent("lostpointercapture", {
            bubbles: true,
            pointerId: id,
            pointerType: "touch",
          })
        );
        root.dispatchEvent(
          new PointerEvent("gotpointercapture", {
            bubbles: true,
            pointerId: id,
            pointerType: "touch",
          })
        );
      }
    };

    root.hasPointerCapture = (id) => captures.has(id);
    root.releasePointerCapture = (id) => {
      captures.delete(id);
      root.dispatchEvent(
        new PointerEvent("lostpointercapture", { pointerId: id })
      );
    };

    const column = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>(".day-column")
    );

    const chip = yield* Effect.fromNullishOr(
      root.querySelector<HTMLElement>(".day-column .event-chip")
    );

    return {
      captures,
      chip,
      column,
      commands,
      notice,
      read: () => current,
      root,
      send: (message: AppMessage) => Queue.offerUnsafe(inbound, message),
      transfers,
    };
  }
);
