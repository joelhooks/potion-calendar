import { runInNewContext } from "node:vm";

export const conversionProofScript = String.raw`
const evidence = JSON.parse(document.querySelector('#conversion-evidence').textContent);
const dialog = document.querySelector('#event-editor-dialog');
if (!dialog) throw Error('Missing real editor dialog');
if (!dialog.open) dialog.showModal();
const title = dialog.querySelector('#event-title');
const type = dialog.querySelector('#event-type');
const toast = dialog.querySelector('[data-conversion-undo]');
const footer = dialog.querySelector('.editor-footer');
const save = footer?.querySelector('#event-editor-dialog-confirm');
const cancel = footer?.querySelector('button[type="button"]');
if (!footer || !save || !cancel) throw Error('Missing editor footer actions');
if (!title || title.value !== evidence.title || !type) throw Error('Wrong creation draft');
if (evidence.writes !== 0) throw Error('Conversion or Undo performed a remote write');
if (JSON.stringify(evidence.beforeDraft) !== JSON.stringify(evidence.restoredDraft)) throw Error('Undo did not restore the exact previous draft');
if (evidence.stage === 'converted') {
  if (type.value !== evidence.target || !toast || toast.textContent !== 'Converted to ' + evidence.label + 'Undo') throw Error('Missing exact conversion toast or type');
  const undo = toast.querySelector('button');
  if (!undo || undo.disabled || undo.textContent !== 'Undo' || undo.title !== 'Undo (Mod+Z)') throw Error('Missing enabled conversion Undo');
  if (toast.getAttribute('role') !== 'status' || toast.getAttribute('aria-live') !== 'polite') throw Error('Conversion announcement lost its accessible status');
  const notice = footer.previousElementSibling;
  if (!notice?.contains(toast) || notice.style.position !== 'static' || toast.style.position !== 'static') throw Error('Conversion notice is not in normal flow above the footer');
  const a = toast.getBoundingClientRect();
  for (const [name, control] of [['Save', save], ['Cancel', cancel]]) {
    const b = control.getBoundingClientRect();
    if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) throw Error('Conversion toast overlaps footer ' + name);
  }
  document.documentElement.dataset.conversionFooterDisjoint = 'pass';
} else if (toast || type.value !== (evidence.beforeDraft.eventType || 'default')) {
  throw Error('A before/restored draft retained the conversion toast or type');
}
const controls = [title, type, cancel, save, ...(toast ? [toast.querySelector('button')] : [])];
const measurements = [];
for (const control of controls) {
  if (!control || control.disabled) throw Error('Dead conversion control');
  control.scrollIntoView({block: 'nearest'});
  control.focus();
  if (document.activeElement !== control) throw Error('Conversion control cannot receive focus');
  const box = control.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0 || box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1) throw Error('Clipped conversion control');
  measurements.push({id:control.id, left:box.left, right:box.right, top:box.top, bottom:box.bottom});
}
if (document.documentElement.scrollWidth > innerWidth + 1) throw Error('Conversion scene widens the page');
if (toast) toast.querySelector('button').focus();
document.documentElement.dataset.conversionMeasurements = JSON.stringify(measurements);
document.documentElement.dataset.conversionProof = 'pass';
`;

export const executeConversionProofWithStandInBoxes = (
  html: string,
  width: number,
  height: number,
  overlapFooter?: "save" | "cancel"
) => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const proofDocument = frame.contentDocument;

  if (proofDocument === null) {
    frame.remove();
    throw new Error("Missing proof document");
  }

  proofDocument.documentElement.innerHTML = new DOMParser().parseFromString(
    html,
    "text/html"
  ).documentElement.innerHTML;
  const dialog = proofDocument.querySelector("dialog");

  if (dialog !== null) {
    Object.defineProperty(dialog, "showModal", {
      value: () => {
        dialog.setAttribute("open", "");
      },
    });
  }

  const scrolled: Element[] = [];

  for (const element of proofDocument.querySelectorAll("*")) {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => {
        const footerBox = (action: "save" | "cancel") =>
          new DOMRect(
            width - (action === "save" ? 86 : 160),
            height - 64,
            action === "save" ? 62 : 64,
            44
          );

        if (element.id === "event-editor-dialog-confirm") {
          return footerBox("save");
        }

        if (element.matches('.editor-footer > button[type="button"]')) {
          return footerBox("cancel");
        }

        if (
          overlapFooter !== undefined &&
          element.matches("[data-conversion-undo]")
        ) {
          const box = footerBox(overlapFooter);

          return new DOMRect(box.left + 4, box.top - 36, box.width - 8, 44);
        }

        return new DOMRect(24, 100, Math.min(240, width - 48), 44);
      },
    });
    Object.defineProperty(element, "scrollIntoView", {
      value: () => {
        scrolled.push(element);
      },
    });
  }

  Object.defineProperty(proofDocument.documentElement, "scrollWidth", {
    value: width,
  });
  const script = proofDocument.querySelector("#conversion-proof")?.textContent;

  if (script === undefined || script === null || script === "") {
    frame.remove();
    throw new Error("Missing embedded conversion proof");
  }

  try {
    runInNewContext(script, {
      document: proofDocument,
      innerHeight: height,
      innerWidth: width,
    });
  } finally {
    frame.remove();
  }

  proofDocument.documentElement.dataset.conversionStandInScrolls = String(
    scrolled.length
  );

  return proofDocument.documentElement.dataset.conversionProof;
};
