const keyPart = (part: string, platform: string): string => {
  const mac = /Mac|iPhone|iPad/u.test(platform);

  const labels = new Map([
    ["Mod", mac ? "⌘" : "Ctrl"],
    ["Shift", mac ? "⇧" : "Shift"],
    ["Alt", mac ? "⌥" : "Alt"],
    ["Escape", "Esc"],
    ["Enter", "↵"],
    ["ArrowLeft", "←"],
    ["ArrowRight", "→"],
    ["ArrowUp", "↑"],
    ["ArrowDown", "↓"],
    ["Backspace", mac ? "⌫" : "Backspace"],
  ]);

  return (
    labels.get(part) ?? (/^[a-z]$/u.test(part) ? part.toUpperCase() : part)
  );
};

export const formatKey = (key: string, platform = navigator.platform): string =>
  key
    .split(" ")
    .map((step) =>
      step
        .split("+")
        .map((part) => keyPart(part, platform))
        .join(/Mac|iPhone|iPad/u.test(platform) ? "" : "+")
    )
    .join(" then ");

export const displayedKeyTokens = (
  key: string,
  platform = navigator.platform
): readonly string[] => [
  formatKey(key, platform),
  ...key.split(/[ +]/u).map((part) => keyPart(part, platform)),
];
