import { runInNewContext } from "node:vm";

export const aboutCommandProof = String.raw`
(() => {
  const requireFact = (condition, message) => { if (!condition) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#about-command-evidence').textContent);
  const dialog = document.querySelector('#keyboard-command-dialog');
  requireFact(dialog, 'About command menu is missing');
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => {
    requireFact(dialog.matches(':modal'), 'About proof must open the real native command dialog');
    requireFact(dialog.getAttribute('aria-label') === 'Command menu', 'Wrong command dialog heading');
    requireFact(innerWidth === evidence.width, 'Wrong About fixture width');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'About scene overflows horizontally');
    const query = dialog.querySelector('#keyboard-query');
    requireFact(query && query.value === 'About', 'About proof did not exercise the actual filter');
    const about = dialog.querySelector('#command-about');
    if (evidence.shell === 'mac') {
      requireFact(about && !about.disabled && about.getAttribute('aria-disabled') === 'false', 'Mac About entry is absent or disabled');
      requireFact(about.textContent.trim() === 'About', 'About wording or shortcut changed');
      requireFact(dialog.textContent.includes('Settings & help'), 'About is in the wrong section');
    } else {
      requireFact(!about, 'Web or legacy command menu offered About');
    }
    const control = evidence.shell === 'mac' ? about : dialog.querySelector('#command-search-query');
    requireFact(control && !control.disabled, 'About proof has no live visible option');
    const box = control.getBoundingClientRect();
    requireFact(box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, 'About proof control is clipped');
    control.focus();
    requireFact(document.activeElement === control, 'About proof control cannot receive focus');
    document.documentElement.dataset.aboutCommandProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'desktop-about';
  });
})();
`;

export const executeAboutProofWithStandInBoxes = (
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
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => {
        const dialog = element.closest("dialog");

        return dialog !== null && !dialog.hasAttribute("open")
          ? new DOMRect()
          : new DOMRect(24, 100, Math.min(240, width - 48), 44);
      },
    });

    if (element instanceof HTMLElement) {
      Object.defineProperty(element, "focus", {
        value: () =>
          Object.defineProperty(document, "activeElement", {
            configurable: true,
            value: element,
          }),
      });
    }
  }

  runInNewContext(aboutCommandProof, {
    document,
    innerHeight: 900,
    innerWidth: width,
    requestAnimationFrame: (onFrame: FrameRequestCallback) => {
      onFrame(0);
    },
  });
};
