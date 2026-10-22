import { runInNewContext } from "node:vm";

export const commandChoiceProofScript = String.raw`
const evidence = JSON.parse(document.querySelector('#command-choice-evidence').textContent);
const requireFact = (ok, text) => { if (!ok) throw Error(text); };
const staged = evidence.scene === 'color-staged';
const dialog = document.querySelector(staged ? '#event-editor-dialog' : '#keyboard-command-dialog');
requireFact(dialog, 'Missing command-choice dialog');
dialog.showModal();
requireFact(dialog.open && dialog.matches(':modal'), 'Command-choice dialog is not modal');
let targets;
if (staged) {
  requireFact(evidence.initialColor === null && evidence.draftColor === '7' && evidence.sourceColor === null, 'Color did not remain an unsaved draft override');
  requireFact(evidence.writes === 0 && JSON.stringify(evidence.commands) === JSON.stringify(['Open','Action']) && evidence.action === 'ColorSelected', 'Color bypassed existing editor handoff or wrote immediately');
  const blue = dialog.querySelector('[role="radio"][aria-label="Blue"]');
  requireFact(blue && blue.getAttribute('aria-checked') === 'true', 'Staged Blue choice is not selected');
  requireFact(dialog.querySelector('#event-color')?.getAttribute('aria-checked') === 'false', 'Calendar color stayed selected');
  requireFact(document.activeElement === blue, 'Staged color focus is not Blue');
  const legend = dialog.querySelector('[aria-label="Event color"] legend');
  requireFact(legend && blue.getBoundingClientRect().top - legend.getBoundingClientRect().bottom >= 4, 'Staged color ring touches its label');
  targets = [blue];
} else {
  const options = [...dialog.querySelectorAll('[role="option"]')];
  const titles = options.map(node => node.textContent.trim());
  if (evidence.scene === 'theme') {
    requireFact(JSON.stringify(titles) === JSON.stringify(['Auto','Light mode','Dark mode']), 'Missing explicit theme choice');
    requireFact(evidence.themeTargets.join(',') === 'auto,light,dark', 'Theme choices cycle instead of selecting');
  } else if (evidence.scene === 'week-start' || evidence.scene === 'week-filtered') {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    requireFact(!titles.includes(days[evidence.weekStart]), 'Current week start leaked into choices');
    if (evidence.scene === 'week-start') requireFact(JSON.stringify(titles) === JSON.stringify(days.filter((_,i) => i !== evidence.weekStart)), 'Missing week-start choice');
    else requireFact(evidence.query === 'Monday' && evidence.exact === 'week-start-1' && titles.includes('Monday'), 'Week-start filtering lost exact selection');
  } else if (evidence.scene === 'colors' || evidence.scene === 'colors-no-palette') {
    requireFact(JSON.stringify(titles) === JSON.stringify(evidence.scene === 'colors' ? ['Use calendar color','Red','Blue'] : ['Use calendar color']), 'Provider palette was assumed or calendar default omitted');
  } else {
    const color = dialog.querySelector('#command-colors');
    requireFact(color && color.disabled === true, 'Ineligible color parent is enabled');
    requireFact(evidence.scene === 'colors-read-only' ? evidence.readOnly === true : evidence.selected === 2, 'Missing disabled color precondition');
    targets = [color];
  }
  if (!targets) {
    requireFact(options.length > 0 && options.every(node => !node.disabled), 'Eligible submenu contains a disabled choice');
    targets = options;
  }
}
for (const target of targets) {
  const box = target.getBoundingClientRect();
  requireFact(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, 'Command-choice target is clipped');
}
requireFact(document.documentElement.scrollWidth <= innerWidth, 'Command-choice scene widened viewport');
document.documentElement.dataset.commandChoiceProof = 'pass';
document.documentElement.dataset.fixtureReady = 'command-choice';
`;

interface StandInFocus {
  element: Element | null;
}

export const executeCommandChoiceProofWithStandIns = (
  html: string,
  width: number,
  presentation: "modal" | "closed" | "nonmodal" = "modal"
): Document => {
  const document = new DOMParser().parseFromString(html, "text/html");

  const script = document.querySelector(
    "script[data-command-choice-proof]"
  )?.textContent;

  if (script !== commandChoiceProofScript) {
    throw new Error("Missing exact command-choice proof");
  }

  const focus: StandInFocus = { element: null };
  Object.defineProperty(document, "activeElement", {
    get: () => focus.element,
  });

  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog")) {
    let modal = false;
    const matches = dialog.matches.bind(dialog);
    Object.defineProperty(dialog, "showModal", {
      value: () => {
        if (presentation !== "closed") {
          dialog.open = true;
          modal = presentation === "modal";
          focus.element = dialog.querySelector("[autofocus]");
        }
      },
    });
    Object.defineProperty(dialog, "matches", {
      value: (selector: string) =>
        selector === ":modal" ? modal : matches(selector),
    });
  }

  for (const node of document.querySelectorAll(
    '[role="option"], [role="radio"]'
  )) {
    Object.defineProperty(node, "getBoundingClientRect", {
      value: () => new DOMRect(200, 200, 300, 36),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  runInNewContext(script, { document, innerHeight: 900, innerWidth: width });

  if (document.documentElement.dataset.commandChoiceProof !== "pass") {
    throw new Error("Command-choice proof did not finish");
  }

  return document;
};
