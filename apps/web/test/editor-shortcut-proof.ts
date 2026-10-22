import { runInNewContext } from "node:vm";

export const shortcutProofScript = (eligible: boolean) => `
const eligible = ${eligible};
const dialog = document.querySelector('#event-editor-dialog');
if (eligible) {
  if (!dialog) throw Error('Missing editor');
  if (!dialog.open) dialog.showModal();
  const control = document.querySelector('#event-add-meet');
  if (!control || control.disabled || dialog.dataset.initialFocus !== control.id) throw Error('Unusable conferencing target');
  control.focus();
  if (document.activeElement !== control) throw Error('Conferencing focus failed');
  const bounds = dialog.getBoundingClientRect();
  const button = control.getBoundingClientRect();
  if (bounds.left < -1 || bounds.right > innerWidth + 1 || bounds.top < -1 || bounds.bottom > innerHeight + 1) throw Error('Editor clipped');
  if (button.width <= 0 || button.height <= 0 || button.left < bounds.left || button.right > bounds.right || button.top < bounds.top || button.bottom > bounds.bottom) throw Error('Conferencing control clipped');
} else {
  if (dialog) throw Error('Refused key opened editor');
  if (document.querySelector('#event-add-meet')) throw Error('Refused key exposed editable target');
}
if (document.documentElement.scrollWidth > innerWidth) throw Error('Page widened');
document.documentElement.dataset.editorShortcutProof = 'pass';`;

const executeShortcutDocumentProof = (
  document: Document,
  html: string,
  width: number
) => {
  const root = document.createElement("html");
  root.innerHTML = html;
  document.documentElement.replaceWith(root);
  const dialog = document.querySelector("dialog");

  if (dialog !== null) {
    Object.defineProperty(dialog, "showModal", {
      value: () => {
        dialog.setAttribute("open", "");
      },
    });
  }

  for (const element of document.querySelectorAll(
    "#event-editor-dialog,#event-add-meet"
  )) {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () =>
        element.id === "event-add-meet"
          ? new DOMRect(width / 2 - 220, 400, 140, 30)
          : new DOMRect(width / 2 - 300, 100, 600, 700),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  const script = document.querySelector("script")?.textContent;

  if (script === undefined || script === null || script === "") {
    throw new Error("Missing exported proof script");
  }

  runInNewContext(script, { document, innerHeight: 900, innerWidth: width });

  if (document.documentElement.dataset.editorShortcutProof !== "pass") {
    throw new Error("Exported proof did not finish");
  }

  return document;
};

export const prepareShortcutProofWithStandInBoxes = () => {
  const frame = globalThis.document.createElement("iframe");
  globalThis.document.body.append(frame);
  const document = frame.contentDocument;

  if (document === null) {
    frame.remove();
    throw new Error("Missing fixture document");
  }

  return {
    dispose: () => {
      frame.remove();
    },
    execute: (html: string, width: number) =>
      executeShortcutDocumentProof(document, html, width),
  };
};

export const executeShortcutProofWithStandInBoxes = (
  html: string,
  width: number
) => {
  const proof = prepareShortcutProofWithStandInBoxes();

  try {
    return proof.execute(html, width);
  } finally {
    proof.dispose();
  }
};
