import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { macNotificationInfo } from "../scripts/package-mac.ts";

it.effect(
  "the generated notification plist overlay changes only the alert-style key",
  () =>
    Effect.sync(() => {
      expect(macNotificationInfo).toEqual({
        NSUserNotificationAlertStyle: "alert",
      });

      const original = {
        CFBundleIdentifier: "sh.wzrrd.potion-calendar",
        CFBundleName: "Potion Calendar",
        NSHighResolutionCapable: true,
      };

      expect({ ...original, ...macNotificationInfo }).toEqual({
        ...original,
        NSUserNotificationAlertStyle: "alert",
      });
    })
);
