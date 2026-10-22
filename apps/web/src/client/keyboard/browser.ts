import { Effect, Schema } from "effect";
import { Command } from "foldkit";

import { ordinaryLink } from "../../layout/event-links.js";
import { Message } from "../message.js";

export const OpenProviderOriginal = Command.define("OpenProviderOriginal", {
  args: { href: Schema.String },
  execute: ({ href }) =>
    Effect.sync(() => {
      const safe = ordinaryLink(href);

      if (
        safe?.startsWith("http:") === true ||
        safe?.startsWith("https:") === true
      ) {
        window.open(safe, "_blank", "noopener,noreferrer");
      }

      return Message.Navigated();
    }),
  messages: [Message.Navigated],
});

export const FocusShortcutSearch = Command.define("FocusShortcutSearch", {
  execute: Effect.sync(() => {
    document.querySelector<HTMLInputElement>("#shortcuts-query")?.focus();

    return Message.Navigated();
  }),
  messages: [Message.Navigated],
});
