import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Session } from "electron";

import {
  acceptsDesktopFrame,
  desktopPermission,
} from "../src/bridge-policy.js";

type Permission = Parameters<
  NonNullable<Parameters<Session["setPermissionCheckHandler"]>[0]>
>[1];

const decisions: Record<Permission, boolean> = {
  ar: false,
  "automatic-fullscreen": false,
  "background-fetch": false,
  "background-sync": false,
  "captured-surface-control": false,
  "clipboard-read": false,
  "clipboard-sanitized-write": false,
  "deprecated-sync-clipboard-read": false,
  "display-capture": false,
  fileSystem: false,
  fullscreen: false,
  geolocation: false,
  "geolocation-approximate": false,
  "hand-tracking": false,
  hid: false,
  "idle-detection": false,
  keyboardLock: false,
  "local-fonts": false,
  "local-network": false,
  "local-network-access": false,
  "loopback-network": false,
  media: false,
  mediaKeySystem: false,
  midi: false,
  midiSysex: false,
  nfc: false,
  notifications: true,
  openExternal: false,
  "payment-handler": false,
  "periodic-background-sync": false,
  "persistent-storage": false,
  pointerLock: false,
  "screen-wake-lock": false,
  sensors: false,
  serial: false,
  "smart-card": false,
  "speaker-selection": false,
  "storage-access": false,
  "system-wake-lock": false,
  "top-level-storage-access": false,
  unknown: false,
  usb: false,
  vr: false,
  "web-app-installation": false,
  "web-printing": false,
  "window-management": false,
};

const origin = "https://calendar.wzrrd.sh";

it.effect(
  "allows only notifications across every permission in the pinned Electron API",
  () =>
    Effect.sync(() => {
      for (const [permission, expected] of Object.entries(decisions)) {
        expect(desktopPermission(permission, origin, `${origin}/`, true)).toBe(
          expected
        );
        expect(desktopPermission(permission, origin, `${origin}/`, false)).toBe(
          false
        );
        expect(
          desktopPermission(
            permission,
            origin,
            "https://other.example.test/",
            true
          )
        ).toBe(false);
      }
    })
);

it.effect("accepts only the exact configured origin in its main frame", () =>
  Effect.sync(() => {
    for (const url of [
      "https://calendar.wzrrd.sh.evil.example.test/",
      "https://evil.example.test/calendar.wzrrd.sh",
      "http://calendar.wzrrd.sh/",
      "file:///private/prompt.html",
      "data:text/html,calendar.wzrrd.sh",
      "about:blank",
      "not a URL",
    ]) {
      expect(acceptsDesktopFrame(origin, url, true)).toBe(false);
      expect(desktopPermission("notifications", origin, url, true)).toBe(false);
    }

    expect(
      acceptsDesktopFrame(origin, `${origin}/settings/menu-bar`, true)
    ).toBe(true);
    expect(acceptsDesktopFrame(origin, `${origin}:443/`, true)).toBe(true);
    expect(acceptsDesktopFrame(origin, `${origin}/`, false)).toBe(false);
  })
);
