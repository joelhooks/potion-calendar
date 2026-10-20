import type { DesktopBridge } from "@calendar/core/desktop-bridge";
import { Effect, Option } from "effect";
import { Command } from "foldkit";

import { Message } from "../message.js";
import { DesktopRequest } from "./model.js";
import { runDesktopRequest } from "./runtime.js";

export const browserDesktop = (): Option.Option<DesktopBridge> =>
  typeof window === "undefined"
    ? Option.none()
    : Option.fromUndefinedOr(window.potionDesktop);

export const ApplyDesktopRequest = Command.define("ApplyDesktopRequest", {
  args: { request: DesktopRequest },
  execute: ({ request }) =>
    Effect.suspend(() => runDesktopRequest(request, browserDesktop())).pipe(
      Effect.map((notice) => Message.ReceivedDesktop({ notice }))
    ),
  messages: [Message.ReceivedDesktop],
});
