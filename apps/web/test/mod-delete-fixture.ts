import { Option } from "effect";

import type { AppModel, AppMessage } from "../src/client/app.js";
import { keyboardMessage } from "../src/client/keyboard/input.js";

export const modDeleteKey = (
  model: AppModel,
  input: {
    readonly alias: string;
    readonly shift: boolean;
    readonly platform: "MacIntel" | "Win32";
    readonly target?: HTMLElement;
    readonly mod?: boolean;
  }
): Option.Option<AppMessage> => {
  const target = input.target ?? document.createElement("button");
  let message = Option.none<AppMessage>();

  target.addEventListener(
    "keydown",
    (event) => {
      if (event instanceof KeyboardEvent) {
        message = keyboardMessage(
          model,
          event,
          model.calendar.now,
          input.platform
        );
      }
    },
    { once: true }
  );
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: input.mod !== false && input.platform === "Win32",
      key: input.alias,
      metaKey: input.mod !== false && input.platform === "MacIntel",
      shiftKey: input.shift,
    })
  );

  return message;
};
