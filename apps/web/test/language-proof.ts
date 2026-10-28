import { runInNewContext } from "node:vm";

export const languageProof = String.raw`
(() => {
  const requireFact = (condition, message) => { if (!condition) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#app-language-evidence').textContent);
  const dialog = evidence.scene === 'date' ? document.querySelector('#keyboard-command-dialog') : evidence.scene === 'editor' ? document.querySelector('#event-editor-dialog') : null;
  if (dialog && !dialog.open) dialog.showModal();
  const target = evidence.scene === 'general' ? document.querySelector('#settings-language') : evidence.scene === 'date' ? document.querySelector('#command-date-' + evidence.day) : evidence.scene === 'editor' ? document.querySelector('#event-startTime') : [...document.querySelectorAll('h2')].find(element => element.textContent === evidence.expected);
  requireFact(target, 'Locale scene target is missing');
  target.scrollIntoView({ block: 'center', inline: 'nearest' });
  requestAnimationFrame(() => {
    requireFact(innerWidth === evidence.width, 'Wrong locale fixture width');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Locale scene overflows horizontally');
    if (dialog) requireFact(dialog.matches(':modal'), 'Locale proof must open the real native dialog');
    if (evidence.scene === 'general') {
      requireFact(target.value === evidence.locale, 'Language control lost the saved choice');
      requireFact(target.options.length === 21, 'Language catalog must have twenty locales plus browser default');
    } else if (evidence.scene === 'editor') {
      requireFact(target.value === evidence.expected, 'Editor clock did not use the app locale');
    } else {
      requireFact(target.textContent === evidence.expected, 'Date presentation did not use the app locale');
    }
    const box = target.getBoundingClientRect();
    requireFact(box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, 'Locale scene target is clipped');
    document.documentElement.dataset.appLanguageProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'app-language';
  });
})();
`;

export const executeLanguageProofWithStandInBoxes = (
  document: Document,
  width: number
) => {
  for (const dialog of document.querySelectorAll("dialog")) {
    const matches = dialog.matches.bind(dialog);
    Object.defineProperty(dialog, "showModal", {
      value: () => {
        dialog.setAttribute("open", "");
      },
    });
    Object.defineProperty(dialog, "matches", {
      value: (selector: string) =>
        selector === ":modal" ? dialog.hasAttribute("open") : matches(selector),
    });
  }

  for (const element of document.querySelectorAll("*")) {
    Object.defineProperty(element, "scrollIntoView", {
      value: () => {
        document.documentElement.dataset.standInScroll = "app-language";
      },
    });
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () =>
        element.closest("dialog:not([open])") === null
          ? new DOMRect(24, 100, Math.min(240, width - 48), 44)
          : new DOMRect(),
    });
  }

  runInNewContext(languageProof, {
    document,
    innerHeight: 900,
    innerWidth: width,
    requestAnimationFrame: (onFrame: FrameRequestCallback) => {
      onFrame(0);
    },
  });
};
