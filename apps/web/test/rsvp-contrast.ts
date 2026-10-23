const luminance = (hex: string): number => {
  const normalized =
    hex.length === 4
      ? hex.replaceAll(/[\da-f]/giu, (channel) => channel + channel)
      : hex;

  const channels = normalized.startsWith("#")
    ? [1, 3, 5].map((index) =>
        Number.parseInt(normalized.slice(index, index + 2), 16)
      )
    : (normalized.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);

  if (
    channels.length !== 3 ||
    channels.some((channel) => !Number.isFinite(channel))
  ) {
    throw new Error(`Unsupported CSS colour: ${hex}`);
  }

  let result = 0;

  for (const [index, value] of channels.entries()) {
    const channel = value / 255;
    const weight = [0.2126, 0.7152, 0.0722][index] ?? 0;

    const linear =
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

    result += linear * weight;
  }

  return result;
};

export const rsvpContrast = (first: string, second: string): number => {
  const a = luminance(first);
  const b = luminance(second);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

export const chipClassDeclaration = (
  chip: HTMLElement,
  sheet: CSSStyleSheet,
  property: string
): string => {
  let specificity = -1;
  let value = "";

  for (const rule of sheet.cssRules) {
    if (!(rule instanceof window.CSSStyleRule)) {
      continue;
    }

    for (const selector of rule.selectorText.split(",")) {
      const declared = rule.style.getPropertyValue(property);

      if (declared === "" || !chip.matches(selector)) {
        continue;
      }

      if (!/^[.\w\s-]+$/u.test(selector)) {
        throw new Error(`Unsupported chip class selector: ${selector}`);
      }

      const classes = (selector.match(/\.[\w-]+/gu) ?? []).length;

      if (classes >= specificity) {
        specificity = classes;
        value = declared;
      }
    }
  }

  const variable = /^var\((?<variable>--[\w-]+)\)$/u.exec(value)?.groups
    ?.variable;

  return variable === undefined
    ? value
    : chip.style.getPropertyValue(variable).trim();
};
