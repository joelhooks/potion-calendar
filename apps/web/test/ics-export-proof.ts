import { runInNewContext } from "node:vm";

export const icsExportProofScript = String.raw`
const requireFact = (ok, text) => { if (!ok) throw Error(text); };
const evidence = JSON.parse(document.querySelector('#ics-export-evidence').textContent);
const dialog = document.querySelector('#keyboard-command-dialog');
requireFact(dialog, 'Missing command dialog');
dialog.showModal();
requireFact(dialog.open && dialog.matches(':modal'), 'Command dialog is not modal');
const entry = dialog.querySelector('#command-export-ics');
requireFact(entry && !entry.disabled && entry.textContent.trim() === 'Export as .ics', 'Missing enabled ICS export catalog entry');
requireFact(evidence.selectedCount === 2, 'Wrong multi-selection precondition');
requireFact(evidence.commands.length === 1 && evidence.commands[0] === 'DownloadSelectedIcs', 'Export escaped the single local command');
requireFact(evidence.exportedCount === 2 && evidence.closed && evidence.calendarUnchanged, 'Export lost selection or changed calendar data');
requireFact(evidence.kind === 'stand-in dispatch; no browser download or provider call', 'Missing evidence limit');
const box = entry.getBoundingClientRect();
requireFact(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, 'ICS export entry is clipped');
requireFact(document.documentElement.scrollWidth <= innerWidth, 'Catalog widened viewport');
document.documentElement.dataset.icsExportProof = 'pass';
document.documentElement.dataset.fixtureReady = 'ics-export';
`;

export const executeIcsExportProofWithStandIns = (
  html: string,
  width: number
): Document => {
  const document = new DOMParser().parseFromString(html, "text/html");

  const script = document.querySelector(
    "script[data-ics-export-proof]"
  )?.textContent;

  if (script !== icsExportProofScript) {
    throw new Error("Missing exact ICS export proof");
  }

  const dialog = document.querySelector<HTMLDialogElement>(
    "#keyboard-command-dialog"
  );

  if (dialog === null) {
    throw new Error("Missing command dialog stand-in");
  }

  const matches = dialog.matches.bind(dialog);
  let modal = false;
  Object.defineProperty(dialog, "showModal", {
    value: () => {
      dialog.setAttribute("open", "");
      modal = true;
    },
  });
  Object.defineProperty(dialog, "matches", {
    value: (selector: string) =>
      selector === ":modal" ? modal : matches(selector),
  });
  const entry = document.querySelector("#command-export-ics");

  if (entry !== null) {
    Object.defineProperty(entry, "getBoundingClientRect", {
      value: () => new DOMRect(200, 200, 300, 36),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  runInNewContext(script, { document, innerHeight: 960, innerWidth: width });

  return document;
};
