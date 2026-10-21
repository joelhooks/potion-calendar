import { Option, Predicate } from "effect";

import type { AppModel } from "../app.js";
import { Message } from "../message.js";
import type { AppMessage } from "../message.js";
import { keyboardRegistry, sequencePrefixes } from "./registry.js";
import type { Scope } from "./registry.js";
import { sequenceKey } from "./sequence.js";

export interface KeyboardInput {
  readonly key: string;
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export const keyToken = ({ key, mod, shift, alt }: KeyboardInput): string =>
  [
    ...(shift && key !== "?" && key !== "`" ? ["Shift"] : []),
    ...(mod ? ["Mod"] : []),
    ...(alt ? ["Alt"] : []),
    key.length === 1 ? key.toLowerCase() : key,
  ].join("+");

export const resolveBinding = (
  model: AppModel,
  input: KeyboardInput,
  now: number,
  scope: Scope
) => {
  const token = keyToken(input);
  const sequence = sequenceKey(model.keyboard, token, now, sequencePrefixes());

  const action = keyboardRegistry.find(
    (candidate) =>
      candidate.keys.includes(sequence.token) &&
      (candidate.scope === scope || candidate.scope === "app") &&
      ["enabled", "shortcut-only"].includes(candidate.availability(model))
  );

  const prefix =
    scope === "grid" &&
    sequencePrefixes().includes(token) &&
    keyboardRegistry.some(
      (candidate) =>
        candidate.keys.some((key) => key.startsWith(`${token} `)) &&
        candidate.availability(model) !== "hidden"
    );

  return { action, prefix, sequence };
};

const targetScope = (target: EventTarget | null): Scope => {
  if (!(target instanceof HTMLElement)) {
    return "grid";
  }

  if (
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"
    ) !== null
  ) {
    return "text";
  }

  return target.closest("dialog") === null ? "grid" : "dialog";
};

const shiftedKeys = new Map([
  ["Backslash", "\\"],
  ["Period", "."],
  ["Comma", ","],
  ["Digit0", "0"],
]);

const keyboardInput = (
  event: KeyboardEvent,
  platform: string
): KeyboardInput | undefined => {
  const mod = /Mac|iPhone|iPad/u.test(platform) ? event.metaKey : event.ctrlKey;

  if ((event.metaKey || event.ctrlKey) && !mod) {
    return undefined;
  }

  let key =
    mod && event.shiftKey
      ? (shiftedKeys.get(event.code) ?? event.key)
      : event.key;

  if (event.altKey && event.code === "KeyT") {
    key = "t";
  }

  return { alt: event.altKey, key, mod, shift: event.shiftKey };
};

export const keyboardMessage = (
  model: AppModel,
  event: KeyboardEvent,
  now: number,
  platform = navigator.platform
): Option.Option<AppMessage> => {
  if (event.defaultPrevented || event.isComposing || event.repeat) {
    return Option.none();
  }

  const input = keyboardInput(event, platform);

  if (input === undefined) {
    return Option.none();
  }

  const scope = targetScope(event.target);
  const token = keyToken(input);

  if (
    scope === "text" &&
    !["Mod+k", "Mod+f", "Shift+Mod+Enter"].includes(token)
  ) {
    return Option.none();
  }

  if (
    model.keyboard.screen !== "closed" &&
    input.key !== "Escape" &&
    !["Mod+k", "Mod+f"].includes(token)
  ) {
    return Option.none();
  }

  if (
    Predicate.isTagged(model.route, "Shortcuts") &&
    !["Escape", "Mod+k", "Mod+f", "/", "?"].includes(token)
  ) {
    return Option.none();
  }

  const match = resolveBinding(model, input, now, scope);

  if (match.action === undefined && !match.prefix) {
    return Option.none();
  }

  return Option.some(Message.PressedCalendarKey({ ...input, now }));
};

export const observeKeyboard = (
  model: AppModel,
  event: KeyboardEvent,
  now: number
): Option.Option<AppMessage> => {
  const handled = keyboardMessage(model, event, now);

  if (Option.isSome(handled)) {
    event.preventDefault();

    return handled;
  }

  return model.keyboard.prefix === ""
    ? Option.none()
    : Option.some(Message.KeyboardResetSequence());
};
