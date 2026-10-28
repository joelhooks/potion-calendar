import type { DesktopBridge } from "@calendar/core/desktop-bridge";
import { Effect, Option } from "effect";

import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { DesktopNotice, DesktopOutcome } from "../src/client/desktop/model.js";
import {
  commandCatalogFixture,
  commandCatalogSettings,
} from "./command-catalog-fixture.js";
import { browserIcsBridge } from "./desktop-ics-fixture.js";

export const aboutCommandFixture = (
  shell: "mac" | "web" | "legacy" = "mac",
  theme: AppModel["settings"]["theme"] = "light"
): AppModel => {
  const base = commandCatalogFixture(shell !== "web", "About", theme);

  return shell === "mac"
    ? update(
        base,
        Message.ReceivedDesktop({
          notice: DesktopNotice.cases.Finished.make({
            canShowAbout: true,
            outcome: DesktopOutcome.cases.Ready.make({
              error: Option.none(),
              settings: commandCatalogSettings(),
            }),
            request: base.desktop.request,
          }),
        })
      ).model
    : base;
};

export const aboutBrowserBridge = (
  showAbout?: DesktopBridge["showAbout"]
): DesktopBridge =>
  showAbout === undefined
    ? browserIcsBridge()
    : { ...browserIcsBridge(), showAbout };

export const installAboutBridge = (bridge?: DesktopBridge) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const descriptor = Object.getOwnPropertyDescriptor(
        window,
        "potionDesktop"
      );

      if (bridge === undefined) {
        Reflect.deleteProperty(window, "potionDesktop");
      } else {
        Object.defineProperty(window, "potionDesktop", {
          configurable: true,
          value: bridge,
        });
      }

      return descriptor;
    }),
    (descriptor) =>
      Effect.sync(() => {
        if (descriptor === undefined) {
          Reflect.deleteProperty(window, "potionDesktop");
        } else {
          Object.defineProperty(window, "potionDesktop", descriptor);
        }
      })
  );
