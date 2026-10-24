import { Option, Predicate } from "effect";

import type { AppModel } from "../app.js";
import { currentConversion } from "../editing/editor-model.js";
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
  readonly control?: boolean;
}

export const keyToken = ({
  key,
  mod,
  shift,
  alt,
  control,
}: KeyboardInput): string =>
  [
    ...(shift && key !== "?" && key !== "`" ? ["Shift"] : []),
    ...(control === true ? ["Control"] : []),
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
      ((sequence.token === "Control+r" &&
        candidate.id === "refresh" &&
        Option.isSome(model.person)) ||
        ((candidate.scope === scope || candidate.scope === "app") &&
          ["enabled", "shortcut-only"].includes(candidate.availability(model))))
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

const literalControlRefresh = (event: KeyboardEvent): boolean =>
  event.ctrlKey &&
  !event.metaKey &&
  !event.altKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "r";

const keyboardInput = (
  event: KeyboardEvent,
  platform: string
): KeyboardInput | undefined => {
  const control = literalControlRefresh(event);

  const mod =
    !control &&
    (/Mac|iPhone|iPad/u.test(platform) ? event.metaKey : event.ctrlKey);

  if ((event.metaKey || event.ctrlKey) && !mod && !control) {
    return undefined;
  }

  let key =
    mod && event.shiftKey
      ? (shiftedKeys.get(event.code) ?? event.key)
      : event.key;

  if (event.altKey && event.code === "KeyT") {
    key = "t";
  }

  const input = { alt: event.altKey, key, mod, shift: event.shiftKey };

  return control ? { ...input, control: true } : input;
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
    !["Mod+k", "Mod+f", "Shift+Mod+Enter", "Control+r"].includes(token) &&
    !(token === "Mod+z" && currentConversion(model.editing.view) !== undefined)
  ) {
    return Option.none();
  }

  if (
    model.keyboard.screen !== "closed" &&
    input.key !== "Escape" &&
    !["Mod+k", "Mod+f", "Control+r"].includes(token)
  ) {
    return Option.none();
  }

  if (
    Predicate.isTagged(model.route, "Shortcuts") &&
    !["Escape", "Mod+k", "Mod+f", "/", "?", "Control+r"].includes(token)
  ) {
    return Option.none();
  }

  const match = resolveBinding(model, input, now, scope);

  if (match.action?.id === "create" && !navigator.onLine) {
    return Option.none();
  }

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
  if (
    event.repeat &&
    !event.isComposing &&
    literalControlRefresh(event) &&
    Option.isSome(model.person)
  ) {
    event.preventDefault();

    return Option.none();
  }

  const handled = keyboardMessage(model, event, now);

  if (Option.isSome(handled)) {
    event.preventDefault();

    return handled;
  }

  return model.keyboard.prefix === ""
    ? Option.none()
    : Option.some(Message.KeyboardResetSequence());
};
