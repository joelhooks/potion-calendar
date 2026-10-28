import {
  AboutReply,
  aboutWire,
  deskDefaultAboutPlatform,
} from "@calendar/core/desktop-bridge";
import { expect, it } from "@effect/vitest";
import { Effect, Function, Schema } from "effect";

import { DesktopError } from "../src/config.js";
import { applicationMenu } from "../src/menus.js";
import { requestNativeAbout } from "../src/native-about.js";
import type { AboutEvent } from "../src/native-about.js";

const fixture = () => {
  const frame = { url: "https://calendar.example.test/week" };
  const contents = { mainFrame: frame };
  const state = { destroyed: false, fail: false, platform: "darwin" };
  const calls: string[] = [];
  const event: AboutEvent = { sender: contents, senderFrame: frame };
  const window = { isDestroyed: () => state.destroyed, webContents: contents };

  const port = {
    platform: Effect.sync(() => state.platform),
    request: Effect.sync(() => {
      calls.push("showAboutPanel");
    }).pipe(
      Effect.flatMap(() =>
        state.fail
          ? Effect.fail(new DesktopError({ message: "private native detail" }))
          : Effect.void
      )
    ),
  };

  const invoke = (payload: Schema.Json = '{"version":1}', current = event) =>
    requestNativeAbout(
      payload,
      current,
      window,
      "https://calendar.example.test",
      port
    ).pipe(Effect.flatMap(Schema.decodeEffect(aboutWire.reply)));

  return { calls, contents, event, frame, invoke, port, state, window };
};

it.effect(
  "native About acknowledges each deliberate request, never panel visibility, and never retries a failure",
  () =>
    Effect.gen(function* nativeHistory() {
      const f = fixture();
      expect(f.state.platform).toBe(deskDefaultAboutPlatform);
      expect(yield* f.invoke()).toEqual(
        AboutReply.cases.Requested.make({ version: 1 })
      );
      expect(f.calls).toEqual(["showAboutPanel"]);
      f.state.fail = true;
      const failed = yield* f.invoke();
      expect(failed._tag).toBe("Failed");
      expect(JSON.stringify(failed)).not.toContain("private native detail");
      expect(f.calls).toHaveLength(2);
      f.state.fail = false;
      expect((yield* f.invoke())._tag).toBe("Requested");
      expect(f.calls).toHaveLength(3);
      expect(
        applicationMenu(
          Function.constVoid,
          Function.constVoid
        )[0]?.submenu?.filter((entry) => entry.role === "about")
      ).toHaveLength(1);
    })
);

it.effect.each([
  "sender",
  "frame",
  "origin",
  "destroyed",
  "unsupported",
  "payload",
] as const)("native About refuses %s before the panel port", (kind) =>
  Effect.gen(function* refusedAbout() {
    const f = fixture();
    let { event } = f;
    let payload: Schema.Json = '{"version":1}';

    if (kind === "sender") {
      event = { ...event, sender: { mainFrame: f.frame } };
    }

    if (kind === "frame") {
      event = { ...event, senderFrame: { ...f.frame } };
    }

    if (kind === "origin") {
      f.frame.url = "https://attacker.example.test/";
    }

    if (kind === "destroyed") {
      f.state.destroyed = true;
    }

    if (kind === "unsupported") {
      f.state.platform = "linux";
    }

    if (kind === "payload") {
      payload = '{"version":1,"url":"https://attacker.example.test/"}';
    }

    expect((yield* f.invoke(payload, event))._tag).toBe("Refused");
    expect(f.calls).toEqual([]);
  })
);

it.effect(
  "About revalidates the window after request admission before touching the panel",
  () =>
    Effect.gen(function* staleWindow() {
      const f = fixture();

      const reply = yield* requestNativeAbout(
        '{"version":1}',
        f.event,
        f.window,
        "https://calendar.example.test",
        {
          ...f.port,
          platform: Effect.sync(() => {
            f.state.destroyed = true;

            return "darwin";
          }),
        }
      ).pipe(Effect.flatMap(Schema.decodeEffect(aboutWire.reply)));

      expect(reply._tag).toBe("Refused");
      expect(f.calls).toEqual([]);
    })
);
