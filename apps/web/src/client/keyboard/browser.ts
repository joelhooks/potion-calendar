import { Effect } from "effect";
import { Command } from "foldkit";

import { Message } from "../message.js";

export const FocusShortcutSearch = Command.define("FocusShortcutSearch", {
  execute: Effect.sync(() => {
    document.querySelector<HTMLInputElement>("#shortcuts-query")?.focus();

    return Message.Navigated();
  }),
  messages: [Message.Navigated],
});
