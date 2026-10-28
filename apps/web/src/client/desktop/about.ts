import { AboutReply } from "@calendar/core/desktop-bridge";
import type { DesktopBridge } from "@calendar/core/desktop-bridge";
import { Effect, Option, Predicate, Schema } from "effect";
import { Command } from "foldkit";

import type { AppModel } from "../app.js";
import { Message } from "../message.js";
import { browserDesktop } from "./commands.js";
import { DesktopBridgeError } from "./io.js";

const aboutFailureMessage =
  "About could not be requested. Try again in the Mac desktop app.";

export const canRequestDesktopAbout = (model: AppModel): boolean =>
  model.desktop.availability === "available" &&
  model.desktop.canShowAbout === true;

export const requestDesktopAbout = Effect.fn("Desktop.requestBrowserAbout")(
  function* requestDesktopAbout(bridge: Option.Option<DesktopBridge>) {
    if (
      Option.isNone(bridge) ||
      !Predicate.isFunction(bridge.value.showAbout)
    ) {
      return AboutReply.cases.Refused.make({
        reason: "unsupported",
        version: 1,
      });
    }

    const { showAbout } = bridge.value;

    return yield* Effect.tryPromise({
      catch: () => new DesktopBridgeError({ message: aboutFailureMessage }),
      // @effect-diagnostics-next-line asyncFunction:off -- The isolated optional About bridge owns the native Promise ABI; application work stays in Effect.
      try: async () => await showAbout({ version: 1 }),
    }).pipe(
      Effect.flatMap(
        Schema.decodeEffect(AboutReply, { onExcessProperty: "error" })
      ),
      Effect.orElseSucceed(() =>
        AboutReply.cases.Failed.make({
          message: aboutFailureMessage,
          version: 1,
        })
      )
    );
  }
);

export const RequestDesktopAbout = Command.define("RequestDesktopAbout", {
  execute: Effect.suspend(() => requestDesktopAbout(browserDesktop())).pipe(
    Effect.map((reply) => Message.ReceivedDesktopAbout({ reply }))
  ),
  messages: [Message.ReceivedDesktopAbout],
});

export const receiveDesktopAbout = (
  model: AppModel,
  reply: typeof AboutReply.Type
): AppModel =>
  AboutReply.match<AppModel>(reply, {
    Failed: ({ message }) => ({
      ...model,
      desktop: { ...model.desktop, error: Option.some(message) },
    }),
    Refused: () => ({
      ...model,
      desktop: {
        ...model.desktop,
        error: Option.some("About is available only in the Mac desktop app."),
      },
    }),
    Requested: () => ({
      ...model,
      desktop: { ...model.desktop, error: Option.none() },
    }),
  });
