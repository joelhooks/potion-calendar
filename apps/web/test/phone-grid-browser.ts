import { Layer, Option, Predicate } from "effect";
import { Runtime, Subscription } from "foldkit";

import { Model, update } from "../src/client/app.js";
import type { AppModel, AppMessage } from "../src/client/app.js";
import { gestureMountFor } from "../src/client/editing/gesture-mount.js";
import { gestureSubscriptions } from "../src/client/editing/gesture-subscription.js";
import { gestureTargetRegistry } from "../src/client/editing/gesture-targets.js";
import { monthHostKey } from "../src/client/month/host.js";
import { MonthRuntime } from "../src/client/month/runtime.js";
import { monthScrollStream } from "../src/client/month/subscription.js";
import { monthViewRegistry } from "../src/client/month/view-state.js";
import { monthViewportMountFor } from "../src/client/month/viewport.js";
import { view } from "../src/features/app.js";
import { unusedClipboardLayer } from "./clipboard-unused-fixture.js";
import { phoneGridFixture, phoneGridScenes } from "./phone-grid-fixture.js";

import "../src/client/style.css";

const query = new URLSearchParams(location.search);

const scene =
  phoneGridScenes.find(
    (item) =>
      item.scene === query.get("scene") &&
      item.theme === query.get("theme") &&
      item.width === document.documentElement.clientWidth
  ) ?? phoneGridScenes[0];

const initial = phoneGridFixture(scene);

const registry = gestureTargetRegistry();

const prepare = gestureMountFor(registry);

const monthViews = monthViewRegistry();

const prepareMonth = monthViewportMountFor(monthViews);

const monthSubscriptions = Subscription.make<
  AppModel,
  AppMessage,
  MonthRuntime
>()((entry) => ({
  month: entry(
    { model: Model },
    {
      dependenciesToStream: ({ model }, readDependencies) =>
        monthScrollStream(model, () => readDependencies().model),
      keepAliveEquivalence: (left, right) =>
        Option.getOrUndefined(monthHostKey(left.model)) ===
        Option.getOrUndefined(monthHostKey(right.model)),
      modelToDependencies: (model) => ({ model }),
    }
  ),
}));

const statistics = { edits: 0, preferenceWrites: 0, swipes: 0 };

const container = document.querySelector<HTMLElement>("#root");

if (container !== null) {
  const model: AppModel =
    scene.scene === "day"
      ? {
          ...initial,
          calendar: {
            ...initial.calendar,
            navigation: {
              ...initial.calendar.navigation,
              days: 7,
              mode: "week",
            },
          },
          phoneGrid: { defaultView: "pending" },
          phoneShell: { ...initial.phoneShell, viewportWidth: undefined },
        }
      : initial;

  const program = Runtime.makeElement({
    Model,
    container,
    devTools: false,
    init: () => ({ model }),
    resources: Layer.merge(
      unusedClipboardLayer,
      MonthRuntime.layerFor(monthViews)
    ),
    subscriptions: Subscription.aggregate(
      gestureSubscriptions(registry),
      monthSubscriptions
    ),
    update: (before: AppModel, message: AppMessage) => {
      const result = update(before, message);

      for (const command of result.commands ?? []) {
        if (command.name === "SavePreferences") {
          statistics.preferenceWrites += 1;
        }

        if (command.name === "DispatchEditing") {
          statistics.edits += 1;
        }
      }

      if (Predicate.isTagged(message, "PhoneSwipedPeriod")) {
        statistics.swipes += 1;
      }

      const { dataset } = document.documentElement;
      dataset.phonePreferenceWrites = String(statistics.preferenceWrites);
      dataset.phoneEditIntents = String(statistics.edits);
      dataset.phoneSwipeMessages = String(statistics.swipes);
      dataset.phoneAnchor = String(result.model.calendar.navigation.anchor);
      dataset.phoneView = result.model.calendar.navigation.mode;
      dataset.phoneSelection = String(result.model.calendar.selected.length);
      dataset.phoneSheet = result.model.phoneShell.mode;

      if (result.model.phoneShell.viewportWidth !== undefined) {
        dataset.phoneGridReady = "native-command-port-stand-in";
      }

      return { model: result.model };
    },
    view: (current, h) =>
      h.div([h.Id("root")], [view(current, h, prepare, prepareMonth).body]),
  });

  const mounted = Runtime.embed(program);
  window.addEventListener(
    "pagehide",
    () => {
      mounted.dispose();
    },
    { once: true }
  );
}
