import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import { Layer } from "effect";
import { Runtime, Subscription } from "foldkit";

import { view } from "../features/app.js";
import {
  Model,
  initWithRoute,
  onUrlChange,
  onUrlRequest,
  update,
} from "./app.js";
import type { AppModel, AppMessage } from "./app.js";
import { desktopProofObserver } from "./desktop/proof.js";
import {
  CalendarEditingClient,
  deletionWriterLayer,
} from "./editing/calendar-client.js";
import { gestureMountFor } from "./editing/gesture-mount.js";
import { gestureSubscriptions } from "./editing/gesture-subscription.js";
import { gestureTargetRegistry } from "./editing/gesture-targets.js";
import { EditingRuntime } from "./editing/runtime.js";
import { CalendarSearchClient } from "./search/client.js";
import { SearchRuntime } from "./search/runtime.js";
import { subscriptions } from "./subscriptions.js";

import "./style.css";

const editingServices = deletionWriterLayer.pipe(
  Layer.provideMerge(CalendarEditingClient.layer("available"))
);

const resources = Layer.merge(
  EditingRuntime.layer.pipe(
    Layer.provide(Layer.merge(BrowserCrypto.layer, editingServices))
  ),
  SearchRuntime.layer.pipe(Layer.provideMerge(CalendarSearchClient.layer))
);

interface DesktopProofOptions {
  slow?: Runtime.SlowConfig<AppModel, AppMessage>;
}

const browserApplication = () => {
  const registry = gestureTargetRegistry();
  const prepare = gestureMountFor(registry);
  const diagnostics: DesktopProofOptions = {};

  if (
    import.meta.hot &&
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
    window.__calendarDesktopProof !== undefined
  ) {
    diagnostics.slow = desktopProofObserver((state) => {
      window.__calendarDesktopProof?.(state);
    });
  }

  return Runtime.makeApplication({
    Model,
    container: document.querySelector("#root"),
    devTools: false,
    init: initWithRoute,
    resources,
    routing: {
      onUrlChange,
      onUrlRequest,
    },
    ...diagnostics,
    subscriptions: Subscription.aggregate(
      subscriptions,
      gestureSubscriptions(registry)
    ),
    update,
    view: (model, h) => view(model, h, prepare),
  });
};

Runtime.run(browserApplication());
