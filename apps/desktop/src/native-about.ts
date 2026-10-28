import {
  AboutReply,
  aboutWire,
  deskDefaultAboutPlatform,
} from "@calendar/core/desktop-bridge";
import { Effect, Option, Schema } from "effect";

import { acceptsDesktopFrame } from "./bridge-policy.js";
import type { DesktopError } from "./config.js";

interface AboutFrame {
  readonly url: string;
}

interface AboutContents {
  readonly mainFrame: AboutFrame;
}

export interface AboutWindow {
  readonly isDestroyed: () => boolean;
  readonly webContents: AboutContents;
}

export interface AboutEvent {
  readonly sender: AboutContents;
  readonly senderFrame: AboutFrame | null;
}

export interface AboutPanelPort {
  readonly platform: Effect.Effect<string>;
  readonly request: Effect.Effect<void, DesktopError>;
}

export const requestNativeAbout = Effect.fn("Desktop.requestNativeAbout")(
  function* requestNativeAbout(
    payload: Schema.Json,
    event: AboutEvent,
    window: AboutWindow,
    origin: string,
    port: AboutPanelPort
  ) {
    const trusted = () =>
      !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      acceptsDesktopFrame(origin, event.senderFrame?.url ?? "", true);

    if (!trusted()) {
      return AboutReply.cases.Refused.make({ reason: "untrusted", version: 1 });
    }

    if ((yield* port.platform) !== deskDefaultAboutPlatform) {
      return AboutReply.cases.Refused.make({
        reason: "unsupported",
        version: 1,
      });
    }

    const request = yield* Schema.decodeUnknownEffect(aboutWire.request, {
      onExcessProperty: "error",
    })(payload).pipe(Effect.option);

    if (Option.isNone(request)) {
      return AboutReply.cases.Refused.make({
        reason: "invalid-request",
        version: 1,
      });
    }

    if (!trusted()) {
      return AboutReply.cases.Refused.make({ reason: "untrusted", version: 1 });
    }

    return yield* port.request.pipe(
      Effect.match({
        onFailure: () =>
          AboutReply.cases.Failed.make({
            message:
              "About could not be requested. Try again in the Mac desktop app.",
            version: 1,
          }),
        onSuccess: () => AboutReply.cases.Requested.make({ version: 1 }),
      })
    );
  },
  Effect.flatMap(Schema.encodeEffect(aboutWire.reply))
);
