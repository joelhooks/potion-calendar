import { Effect, Option, Predicate, Queue } from "effect";
import { Runtime } from "foldkit";

import type { AppMessage, AppModel } from "../src/client/app.js";
import { Model, update } from "../src/client/app.js";
import { ReadPreferences } from "../src/client/commands.js";
import { settingsGeneral } from "../src/features/settings-general.js";
import type { LocationMaps } from "../src/layout/location-maps.js";
import { mapsFixture, settleMapsSnapshot } from "./location-maps-fixture.js";

export const nativeMapsSettings = Effect.fn("MapsTest.nativeSettings")(
  function* nativeSettings() {
    const original = mapsFixture();
    let current: AppModel = original;
    const ready = yield* Queue.unbounded<boolean>();
    const saved = yield* Queue.unbounded<boolean>();
    const container = document.createElement("div");
    container.id = "location-maps-native";
    document.body.append(container);
    localStorage.clear();

    const observer = new MutationObserver(() => {
      if (
        document.querySelector(
          "#location-maps-native #settings-location-maps"
        ) !== null
      ) {
        Queue.offerUnsafe(ready, true);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        observer.disconnect();
        document.querySelector("#location-maps-native")?.remove();
        container.remove();
        localStorage.clear();
      })
    );

    const program = Runtime.makeElement({
      Model,
      container,
      devTools: false,
      init: () => ({ model: original }),
      update: (model: AppModel, message: AppMessage) => {
        const result = update(model, message);
        current = result.model;

        if (Predicate.isTagged(message, "SavedPreferences")) {
          Queue.offerUnsafe(saved, true);
        }

        return {
          ...result,
          commands: (result.commands ?? []).filter(
            (command) => command.name === "SavePreferences"
          ),
        };
      },
      view: (model, h) =>
        h.div([h.Id("location-maps-native")], settingsGeneral(model, h)),
    });

    yield* Effect.acquireRelease(
      Effect.sync(() => Runtime.embed(program)),
      (handle) =>
        Effect.sync(() => {
          handle.dispose();
        })
    );
    yield* Queue.take(ready);

    const choose = Effect.fn("MapsTest.choose")(function* chooseMaps(
      value: typeof LocationMaps.Type
    ) {
      const select = document.querySelector<HTMLSelectElement>(
        "#location-maps-native #settings-location-maps"
      );

      if (select === null) {
        return yield* Effect.die("Missing native maps choice");
      }

      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      yield* Queue.take(saved);
      const person = Option.getOrThrow(current.person);
      const reply = yield* ReadPreferences({ person }).effect;
      const restored = settleMapsSnapshot(update(original, reply).model);

      return {
        restored,
        saved: localStorage.getItem(`calendar.visibility.${person}`),
      };
    });

    return { choose, current: () => current };
  }
);
