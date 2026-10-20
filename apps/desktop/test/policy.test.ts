import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { parseCallback } from "../src/callback.js";
import { desktopOrigin } from "../src/config.js";
import { navigation, startsSystemSignIn } from "../src/navigation.js";
import { clampWindow } from "../src/window-state.js";

const origin = "https://calendar.wzrrd.sh";

it.effect(
  "hosted Google sign-in navigation starts the system-browser handoff rather than continuing embedded OAuth",
  () =>
    Effect.sync(() => {
      expect(
        startsSystemSignIn(
          "https://accounts.google.com/o/oauth2/v2/auth?state=browser-state",
          origin,
          true
        )
      ).toBe(true);
      expect(
        startsSystemSignIn(`${origin}/__fake-google/authorize`, origin, false)
      ).toBe(true);
      expect(
        startsSystemSignIn(`${origin}/__fake-google/authorize`, origin, true)
      ).toBe(false);
      expect(
        startsSystemSignIn(
          "https://example.test/o/oauth2/v2/auth",
          origin,
          true
        )
      ).toBe(false);
      expect(
        startsSystemSignIn("https://accounts.google.com/help", origin, true)
      ).toBe(false);
    })
);

it.effect(
  "navigation admits only the configured origin and explicit external protocols",
  () =>
    Effect.sync(() => {
      for (const target of [
        origin,
        `${origin}/settings`,
        `${origin}/desktop/complete?token=abc`,
      ]) {
        expect(navigation(target, origin)).toBe("window");
      }

      for (const target of [
        "https://example.test/path",
        "mailto:joel@example.test",
      ]) {
        expect(navigation(target, origin)).toBe("browser");
      }

      for (const target of [
        "file:///etc/passwd",
        // oxlint-disable-next-line eslint/no-script-url -- This adversarial URL must be rejected by the navigation policy.
        "javascript:alert(1)",
        "potion:command",
        "http://example.test",
        "data:text/html,hello",
        "https://user:password@calendar.wzrrd.sh",
        "not a URL",
      ]) {
        expect(navigation(target, origin)).toBe("deny");
      }
    })
);

it.effect(
  "callback requires the exact path, loopback host, one token and matching state",
  () =>
    Effect.sync(() => {
      const state = "a".repeat(64);
      const token = "b".repeat(64);
      const callback = `/callback?token=${token}&state=${state}`;
      expect(parseCallback(callback, "127.0.0.1:49152", state)).toBe(token);

      for (const target of [
        callback.replace(state, "c".repeat(64)),
        callback.replace("callback", "other"),
        `${callback}&token=${token}`,
        `${callback}&state=${state}`,
        callback.replace(token, "bad"),
        `http://evil.test${callback}`,
      ]) {
        expect(parseCallback(target, "127.0.0.1:49152", state)).toBeNull();
      }
    })
);

it.effect("window geometry stays fully visible on a current display", () =>
  Effect.sync(() => {
    const display = { height: 775, width: 1200, x: 0, y: 25 };
    expect(
      clampWindow({ height: 1000, width: 1800, x: 5000, y: -1000 }, [display])
    ).toEqual(display);
    expect(
      clampWindow({ height: 600, width: 800, x: 100, y: 50 }, [display])
    ).toEqual({ height: 600, width: 800, x: 100, y: 50 });
    expect(
      clampWindow({ height: 600, width: 800, x: -1000, y: 50 }, [
        { height: 800, width: 1200, x: -1200, y: 0 },
        display,
      ])
    ).toEqual({ height: 600, width: 800, x: -1000, y: 50 });
  })
);

it.effect("production cannot be redirected by a command line origin", () =>
  Effect.gen(function* originConfiguration() {
    expect(yield* desktopOrigin(true)).toBe(origin);
    expect(
      yield* Effect.isFailure(desktopOrigin(true, "https://evil.test"))
    ).toBe(true);
    expect(yield* desktopOrigin(false, "http://127.0.0.1:1355")).toBe(
      "http://127.0.0.1:1355"
    );
    expect(
      yield* Effect.isFailure(desktopOrigin(false, "http://evil.test"))
    ).toBe(true);
  })
);
