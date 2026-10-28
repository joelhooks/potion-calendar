import { runInNewContext } from "node:vm";

export const clipboardLocaleProof = `(() => {
  const metadata = document.querySelector('#clipboard-locale-evidence');
  if (!metadata) throw new Error('Missing clipboard locale evidence');
  const e = JSON.parse(metadata.textContent);
  const target = document.querySelector(e.recipient === 'single-month' ? '.clipboard-toast' : '.clipboard-results');
  if (!target) throw new Error('Missing actual clipboard refusal');
  const reason = e.transition === 'fold' ? 'happens twice when clocks fall back' : "doesn't exist when clocks spring forward";
  const sentence = 'Beta would start at ' + e.clock + ' on ' + e.date + ', which ' + reason + '. Paste it somewhere else.';
  if (!(target.textContent || '').includes(sentence)) throw new Error('Wrong localized clock/date or English refusal sentence');
  if (window.innerWidth !== e.width) throw new Error('Wrong clipboard locale viewport');
  const bounds = target.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.left < 0 || bounds.right > window.innerWidth + 1) throw new Error('Clipboard refusal is outside viewport');
  if (target.scrollWidth > target.clientWidth + 1) throw new Error('Clipboard refusal is horizontally clipped');
  if (document.documentElement.scrollWidth > window.innerWidth + 1) throw new Error('Clipboard locale page overflow');
  document.documentElement.dataset.clipboardLocaleProof = 'pass';
  document.documentElement.dataset.fixtureReady = 'clipboard-locale';
})();`;

export const executeClipboardLocaleProofWithStandInBoxes = (
  document: Document,
  width: number
) => {
  const target = document.querySelector<HTMLElement>(
    ".clipboard-toast, .clipboard-results"
  );

  if (target === null) {
    throw new Error("Missing clipboard refusal stand-in target");
  }

  target.getBoundingClientRect = () => new DOMRect(8, 8, width - 16, 80);
  Object.defineProperty(target, "clientWidth", {
    configurable: true,
    value: width - 16,
  });
  Object.defineProperty(target, "scrollWidth", {
    configurable: true,
    value: width - 16,
  });
  runInNewContext(clipboardLocaleProof, {
    document,
    window: { innerWidth: width },
  });
};
