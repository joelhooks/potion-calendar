import type { CalendarEventValue } from "@calendar/calendar/contracts";
import { Layer, Option, Predicate, pipe } from "effect";
import { AsyncData, Runtime } from "foldkit";

import { Model, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { gestureMountFor } from "../src/client/editing/gesture-mount.js";
import { gestureSubscriptions } from "../src/client/editing/gesture-subscription.js";
import { gestureTargetRegistry } from "../src/client/editing/gesture-targets.js";
import { MonthRuntime } from "../src/client/month/runtime.js";
import { monthViewRegistry } from "../src/client/month/view-state.js";
import { monthViewportMountFor } from "../src/client/month/viewport.js";
import { view } from "../src/features/app.js";
import { unusedClipboardLayer } from "./clipboard-unused-fixture.js";
import { phoneTouchFixture } from "./phone-touch-fixture.js";
import type { PhoneTouchScene } from "./phone-touch-fixture.js";

import "../src/client/style.css";
import "../src/client/coarse-pointer.css";

const query = new URLSearchParams(location.search);

const requested: PhoneTouchScene = {
  height: innerHeight,
  kind: query.get("kind") === "create" ? "create" : "move",
  state: query.get("state") === "read-only" ? "read-only" : "pressed",
  theme: query.get("theme") === "dark" ? "dark" : "light",
  width: document.documentElement.clientWidth,
};

const base = phoneTouchFixture(requested);

const short = query.get("overlap") === "short";

const shortOverlap = (
  event: CalendarEventValue
): readonly CalendarEventValue[] => {
  if (event.eventId === "a-review") {
    return [{ ...event, end: { dateTime: "2026-10-19T09:15:00-07:00" } }];
  }

  if (event.eventId === "b-design") {
    return [
      event,
      ...["C", "D"].map((name) => ({
        ...event,
        eventId: `m4-overlap-${name}`,
        title: `Overlap ${name}`,
      })),
    ];
  }

  return [event];
};

const initial: AppModel = {
  ...base,
  calendar: {
    ...base.calendar,
    reads: short
      ? base.calendar.reads.map((read) => ({
          ...read,
          events: pipe(
            read.events,
            AsyncData.map((data) => ({
              ...data,
              events: data.events.flatMap(shortOverlap),
            }))
          ),
        }))
      : base.calendar.reads,
  },
  editing: {
    ...base.editing,
    gesture: Option.none(),
    gestureRefusal: Option.none(),
  },
  error: Option.none(),
};

const registry = gestureTargetRegistry();

const prepare = gestureMountFor(registry);

const monthViews = monthViewRegistry();

const prepareMonth = monthViewportMountFor(monthViews);

const statistics = {
  completions: 0,
  editorOpeningIntents: 0,
  preferenceWrites: 0,
  refusals: 0,
  swipes: 0,
};

const touchEvents: {
  at: number;
  cancelable: boolean;
  phase: string | undefined;
  prevented: boolean;
  scrollTop: number | undefined;
}[] = [];

const container = document.querySelector<HTMLElement>("#root");

document.documentElement.dataset.phoneTouchCornerSelector =
  ".touch-resize-target";

document.documentElement.dataset.phoneTouchCase = JSON.stringify({
  ...requested,
  shortOverlap: short,
});

if (container !== null) {
  const program = Runtime.makeElement({
    Model,
    container,
    devTools: false,
    init: () => ({ model: initial }),
    resources: Layer.merge(
      unusedClipboardLayer,
      MonthRuntime.layerFor(monthViews)
    ),
    subscriptions: gestureSubscriptions(registry),
    update: (before: AppModel, message: AppMessage) => {
      const result = update(before, message);

      for (const command of result.commands ?? []) {
        if (command.name === "DispatchEditing") {
          statistics.editorOpeningIntents += 1;
        }

        if (command.name === "SavePreferences") {
          statistics.preferenceWrites += 1;
        }
      }

      const { dataset } = document.documentElement;

      if (Predicate.isTagged(message, "CompletedGesture")) {
        statistics.completions += 1;
        dataset.phoneTouchLastGesture = JSON.stringify({
          duplicate: message.gesture.duplicate,
          intent: message.gesture.intent ?? "ordinary",
          range: message.gesture.range,
          targetKey: Option.getOrUndefined(message.gesture.target)?.key ?? null,
        });
      }

      if (Predicate.isTagged(message, "PreviewedGesture")) {
        dataset.phoneTouchPreview = JSON.stringify(
          Option.getOrUndefined(message.preview)?.range ?? null
        );
      }

      if (
        Predicate.isTagged(message, "RefusedGesture") ||
        (Option.isNone(before.error) && Option.isSome(result.model.error))
      ) {
        statistics.refusals += 1;
      }

      if (Predicate.isTagged(message, "PhoneSwipedPeriod")) {
        statistics.swipes += 1;
      }

      dataset.phoneTouchStatistics = JSON.stringify(statistics);
      dataset.phoneTouchError = Option.getOrElse(result.model.error, () => "");
      dataset.phoneTouchSelected = JSON.stringify(
        result.model.calendar.selected
      );
      dataset.phoneTouchAnchor = String(
        result.model.calendar.navigation.anchor
      );

      if (Predicate.isTagged(message, "PreparedGestureHost")) {
        dataset.phoneTouchReady =
          "native input; actual root and reducers; commands held at port; not provider or editor-runtime proof";
      }

      return { model: result.model };
    },
    view: (current, h) =>
      h.div([h.Id("root")], [view(current, h, prepare, prepareMonth).body]),
  });

  const mounted = Runtime.embed(program);

  const observeTouch = (event: TouchEvent): void => {
    touchEvents.push({
      at: performance.now(),
      cancelable: event.cancelable,
      phase:
        document.querySelector<HTMLElement>("#gesture-host")?.dataset
          .touchEditPhase,
      prevented: event.defaultPrevented,
      scrollTop: document.querySelector("#time-viewport")?.scrollTop,
    });
    document.documentElement.dataset.phoneTouchNativeEvents =
      JSON.stringify(touchEvents);
  };

  window.addEventListener("touchmove", observeTouch, { passive: true });
  window.addEventListener(
    "pagehide",
    () => {
      window.removeEventListener("touchmove", observeTouch);
      mounted.dispose();
    },
    { once: true }
  );
}
