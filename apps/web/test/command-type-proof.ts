import { runInNewContext } from "node:vm";

export const commandTypeProof = String.raw`
(() => {
  const requireFact = (condition, message) => { if (!condition) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#command-type-evidence').textContent);
  const dialog = document.querySelector('#keyboard-command-dialog');
  const editor = document.querySelector('#event-editor-dialog');
  if (evidence.stage !== 'menu') {
    requireFact(editor, 'Creation editor is missing');
    if (!editor.open) editor.showModal();
  }
  if (evidence.stage === 'menu') {
    requireFact(dialog, 'Type menu is missing');
    dialog.showModal();
  }
  requestAnimationFrame(() => {
    requireFact(innerWidth === evidence.width, 'Wrong Type fixture width');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Type fixture overflows horizontally');
    if (evidence.stage === 'menu') {
      requireFact(dialog.matches(':modal'), 'Type menu must be a native modal');
      requireFact(dialog.getAttribute('aria-label') === 'Change event type', 'Type menu heading changed');
      const buttons = [...dialog.querySelectorAll('button[id^="command-type-"]')];
      requireFact(buttons.length === 2, 'Type choices must omit the current type');
      requireFact(!dialog.querySelector('#command-type-' + evidence.source), 'Current type leaked into choices');
      for (const button of buttons) {
        const box = button.getBoundingClientRect();
        requireFact(!button.disabled && box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, 'Type choice is disabled or clipped');
      }
    } else {
      requireFact(editor.matches(':modal'), 'Creation editor must be a native modal');
      const type = editor.querySelector('#event-type');
      const expectedType = evidence.stage === 'converted' ? evidence.target : evidence.source;
      requireFact(type && type.value === expectedType, 'Creation draft type is wrong');
      const typeBox = type.getBoundingClientRect();
      requireFact(typeBox.width > 0 && typeBox.height > 0 && typeBox.left >= 0 && typeBox.top >= 0 && typeBox.right <= innerWidth && typeBox.bottom <= innerHeight, 'Creation type is clipped');
      const toast = editor.querySelector('[data-conversion-undo]');
      requireFact(Boolean(toast) === (evidence.stage === 'converted'), 'Conversion Undo visibility is wrong');
      if (toast) {
        requireFact(toast.textContent === 'Converted to ' + evidence.label + 'Undo', 'Conversion target label is wrong');
        const box = toast.getBoundingClientRect();
        requireFact(box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, 'Conversion Undo is clipped');
      }
    }
    document.documentElement.dataset.commandTypeProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'command-type';
  });
})();
`;

export const executeCommandTypeProofWithStandInBoxes = (
  document: Document,
  width: number,
  height: number
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
  }

  runInNewContext(commandTypeProof, {
    document,
    innerHeight: height,
    innerWidth: width,
    requestAnimationFrame: (onFrame: FrameRequestCallback) => {
      onFrame(0);
    },
  });
};
