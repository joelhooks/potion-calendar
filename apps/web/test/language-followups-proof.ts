import { runInNewContext } from "node:vm";

export const languageFollowupsProof = String.raw`
(() => {
  const requireFact = (condition, message) => { if (!condition) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#language-followups-evidence').textContent);
  const dialog = evidence.scene === 'editor' ? document.querySelector('#event-editor-dialog') : evidence.scene === 'date' ? document.querySelector('#keyboard-command-dialog') : null;
  if (dialog && !dialog.open) dialog.showModal();
  const target = evidence.scene === 'general' ? document.querySelector('#settings-language') : evidence.scene === 'editor' ? document.querySelector('#event-startTime') : document.querySelector('#command-date-' + evidence.day);
  requireFact(target, 'Follow-up recipient is missing');
  target.scrollIntoView({ block: 'center', inline: 'nearest' });
  requestAnimationFrame(() => {
    requireFact(innerWidth === evidence.width, 'Wrong follow-up fixture width');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Follow-up scene overflows horizontally');
    if (dialog) requireFact(dialog.matches(':modal'), 'Follow-up proof must open the actual dialog');
    if (evidence.scene === 'general') {
      requireFact(target.value === evidence.stored, 'Stored Language code changed');
      requireFact(target.options.length === 21, 'Language catalog changed');
      requireFact(target.selectedOptions[0].textContent === evidence.expected, 'Compact Language label is wrong');
      requireFact(target.title === 'Stored code: ' + evidence.stored, 'Language code hint is wrong');
    } else if (evidence.scene === 'editor') {
      requireFact(target.value === evidence.expected, 'The actual editor clock bypassed es-419');
    } else {
      requireFact(target.textContent === evidence.expected, 'Actual Go to date label is wrong');
    }
    const box = target.getBoundingClientRect();
    requireFact(box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, 'Follow-up target is clipped');
    document.documentElement.dataset.languageFollowupsProof = 'pass';
    document.documentElement.dataset.labelReadability = 'Requires desk native readability review';
    document.documentElement.dataset.fixtureReady = 'language-followups';
  });
})();
`;

export const executeFollowupsProofWithStandInBoxes = (
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
        document.documentElement.dataset.standInScroll = "language-followups";
      },
    });
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () =>
        element.closest("dialog:not([open])") === null
          ? new DOMRect(24, 100, Math.min(240, width - 48), 44)
          : new DOMRect(),
    });
  }

  runInNewContext(languageFollowupsProof, {
    document,
    innerHeight: 900,
    innerWidth: width,
    requestAnimationFrame: (onFrame: FrameRequestCallback) => {
      onFrame(0);
    },
  });
};
