import { runInNewContext } from "node:vm";

export const selectedEventReadProofScript = String.raw`
const evidence = JSON.parse(document.querySelector('#selected-read-evidence').textContent);
const requireFact = (ok, text) => { if (!ok) throw Error(text); };
const dialog = document.querySelector('#keyboard-command-dialog');
requireFact(dialog, 'Missing command dialog');
dialog.showModal();
requireFact(dialog.open && dialog.matches(':modal'), 'Command dialog is not modal');
const go = document.querySelector('#command-go-to-selection');
const provider = document.querySelector('#command-open-in-provider');
const selected = evidence.scene !== 'no-selection';
const single = evidence.scene !== 'no-selection' && evidence.scene !== 'multiple';
const safe = single && evidence.scene !== 'no-url' && evidence.scene !== 'unsafe-url';
requireFact(selected ? go && !go.disabled : go === null, 'Wrong selection navigation availability');
requireFact(safe ? provider && !provider.disabled : provider === null, 'Wrong provider availability');
requireFact(!go || go.textContent.includes('Go to selection'), 'Wrong navigation label');
requireFact(!provider || provider.textContent.includes('Open in Google Calendar'), 'Wrong provider label');
requireFact(evidence.selected.length === (evidence.scene === 'no-selection' ? 0 : evidence.scene === 'multiple' ? 2 : 1), 'Wrong selection precondition');
if (selected) {
  requireFact(JSON.stringify(evidence.afterGo.selected) === JSON.stringify(evidence.selected), 'Go to selection lost selection');
  requireFact(evidence.afterGo.day === evidence.sourceDay && evidence.afterGo.mode === evidence.beforeMode, 'Go to selection changed view or missed event date');
  requireFact(evidence.afterGo.visible === true, 'Selected calendar remains hidden');
  requireFact(evidence.afterGo.closed === true, 'Go to selection left command menu open');
  requireFact(evidence.afterGo.saved === (evidence.scene === 'hidden-calendar'), 'Wrong reveal preference save');
} else requireFact(evidence.afterGo.commands.length === 0, 'Disabled navigation ran');
if (safe) {
  requireFact(evidence.provider.commands.length === 1 && evidence.provider.commands[0] === 'OpenProviderOriginal', 'Provider action escaped named command');
  requireFact(evidence.provider.href === 'https://calendar.google.com/calendar/event?eid=fixture-original', 'Wrong provider original');
  requireFact(evidence.provider.closed && evidence.provider.unchangedCalendar, 'Provider action mutated calendar or left menu open');
} else requireFact(evidence.provider.commands.length === 0, 'Disabled provider action ran');
for (const button of [go, provider].filter(Boolean)) {
  const box = button.getBoundingClientRect();
  requireFact(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, 'Selected-event action is clipped');
}
requireFact(document.documentElement.scrollWidth <= innerWidth, 'Catalog widened viewport');
document.documentElement.dataset.selectedEventReadProof = 'pass';
document.documentElement.dataset.fixtureReady = 'selected-event-read';
`;

export const executeSelectedEventReadProofWithStandIns = (
  html: string,
  width: number,
  presentation: "modal" | "closed" | "nonmodal" = "modal"
): Document => {
  const document = new DOMParser().parseFromString(html, "text/html");

  const script = document.querySelector(
    "script[data-selected-read-proof]"
  )?.textContent;

  if (
    script === undefined ||
    script === null ||
    script !== selectedEventReadProofScript
  ) {
    throw new Error("Missing exact selected-event read proof");
  }

  const dialog = document.querySelector<HTMLDialogElement>(
    "#keyboard-command-dialog"
  );

  if (dialog === null) {
    throw new Error("Missing command dialog stand-in");
  }

  let modal = false;
  const matches = dialog.matches.bind(dialog);
  Object.defineProperty(dialog, "showModal", {
    value: () => {
      if (presentation !== "closed") {
        dialog.setAttribute("open", "");
        modal = presentation === "modal";
      }
    },
  });
  Object.defineProperty(dialog, "matches", {
    value: (selector: string) =>
      selector === ":modal" ? modal : matches(selector),
  });

  for (const node of document.querySelectorAll(
    "#command-go-to-selection, #command-open-in-provider"
  )) {
    Object.defineProperty(node, "getBoundingClientRect", {
      value: () => new DOMRect(200, 200, 300, 36),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  runInNewContext(script, { document, innerHeight: 900, innerWidth: width });

  if (document.documentElement.dataset.selectedEventReadProof !== "pass") {
    throw new Error("Selected-event read proof did not finish");
  }

  return document;
};
