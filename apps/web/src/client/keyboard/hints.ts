import {
  displayedKeyTokens as sharedKeyTokens,
  formatKey as sharedFormatKey,
} from "@calendar/core/keyboard-hints";

export { globalShortcutBinding } from "@calendar/core/keyboard-hints";

export const formatKey = (key: string, platform = navigator.platform): string =>
  sharedFormatKey(key, platform);

export const displayedKeyTokens = (
  key: string,
  platform = navigator.platform
): readonly string[] => sharedKeyTokens(key, platform);
