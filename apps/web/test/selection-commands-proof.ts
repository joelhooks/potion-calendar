import { runInNewContext } from "node:vm";

export const selectionCommandsProofScript = String.raw`
const evidence = JSON.parse(document.querySelector('#selection-commands-evidence').textContent);
const requireFact = (ok, message) => { if (!ok) throw Error(message); };
const dialog = document.querySelector('#keyboard-command-dialog');
if (evidence.scene === 'no-later') {
  requireFact(!dialog, 'Empty occurrence status left the catalog open');
  const status = document.querySelector('[data-selection-command-status="Ready"]');
  requireFact(status && status.getAttribute('role') === 'status' && status.textContent === 'No later occurrence', 'Wrong occurrence status');
  requireFact(!document.querySelector('[role="alert"]'), 'Absent occurrence became an error');
  requireFact(evidence.selectedBefore === evidence.selectedAfter && evidence.pending === false, 'Empty result changed selection or left a pending task');
} else {
  requireFact(dialog, 'Missing command dialog');
  dialog.showModal();
  requireFact(dialog.open && dialog.matches(':modal'), 'Command dialog is not modal');
  const expected = [['go-to-selection','Go to selection'],['open-in-provider','Open in Google Calendar']];
  if (evidence.scene === 'recurring') expected.push(['next-occurrence','Next occurrence'],['previous-occurrence','Previous occurrence']);
  else requireFact(!document.querySelector('#command-next-occurrence') && !document.querySelector('#command-previous-occurrence'), 'Ordinary event offers recurrence commands');
  for (const [id,label] of expected) {
    const row = document.querySelector('#command-'+id);
    requireFact(row && !row.disabled && row.textContent.includes(label), 'Wrong catalog entry '+label);
    const box = row.getBoundingClientRect();
    const area = dialog.getBoundingClientRect();
    requireFact(box.width > 0 && box.height > 0 && box.left >= Math.max(0,area.left) && box.right <= Math.min(innerWidth,area.right) && box.top >= Math.max(0,area.top) && box.bottom <= Math.min(innerHeight,area.bottom), 'Catalog entry is clipped '+label);
  }
}
requireFact(document.documentElement.scrollWidth <= innerWidth, 'Page overflow');
document.documentElement.dataset.selectionCommandsProof = 'pass';
document.documentElement.dataset.fixtureReady = 'selection-commands';
`;

export const executeSelectionCommandsProofWithStandIns = (
  html: string,
  width: number,
  modal = true
): Document => {
  const document = new DOMParser().parseFromString(html, "text/html");

  const script = document.querySelector(
    "script[data-selection-commands-proof]"
  )?.textContent;

  if (script !== selectionCommandsProofScript) {
    throw new Error("Missing exact selected-command proof script");
  }

  const dialog = document.querySelector<HTMLDialogElement>(
    "#keyboard-command-dialog"
  );

  if (dialog !== null) {
    const matches = dialog.matches.bind(dialog);
    Object.defineProperty(dialog, "showModal", {
      value: () => {
        if (modal) {
          dialog.open = true;
        }
      },
    });
    Object.defineProperty(dialog, "matches", {
      value: (selector: string) =>
        selector === ":modal" ? modal && dialog.open : matches(selector),
    });
  }

  for (const element of document.querySelectorAll(
    "#keyboard-command-dialog, [role=option]"
  )) {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => new DOMRect(100, 100, 400, 40),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  runInNewContext(script, { document, innerHeight: 900, innerWidth: width });

  if (document.documentElement.dataset.selectionCommandsProof !== "pass") {
    throw new Error("Selected-command proof did not finish");
  }

  return document;
};
