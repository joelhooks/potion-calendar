import { runInNewContext } from "node:vm";

export const creatorProofScript = String.raw`
const requireFact = (ok, text) => { if (!ok) throw Error(text); };
const evidence = JSON.parse(document.querySelector('#creator-evidence').textContent);
const panel = document.querySelector('.detail-panel');
requireFact(panel && panel.querySelector('h2').textContent === 'Design planning', 'Missing actual event details');
const list = panel.querySelector('ul');
const rows = Array.from(list.querySelectorAll('li'));
requireFact(rows.length === 3, 'Participant count changed');
requireFact(rows[0].textContent === 'Alex Rivera · OrganizerYes', 'Organizer identity or response changed');
const bylines = Array.from(panel.querySelectorAll('p')).filter(p => p.textContent.startsWith('Created by '));
if (evidence.scene === 'attendee') {
 requireFact(rows[1].textContent === 'Blair Chen · You · Creator · OptionalMaybe', 'Creator attendee lost roles or response');
 requireFact(bylines.length === 0, 'Attendee creator duplicated in byline');
} else {
 requireFact(evidence.scene === 'non-attendee', 'Unknown creator scene');
 requireFact(rows[1].textContent === 'Blair Chen · You · OptionalMaybe', 'Existing attendee roles changed');
 requireFact(bylines.length === 1 && bylines[0].textContent === 'Created by Drew Morgan', 'Missing or duplicate creator byline');
 requireFact(bylines[0] === list.nextElementSibling && bylines[0].classList.contains('muted'), 'Creator byline is not muted below list');
}
requireFact(rows[2].textContent === 'Casey QuinnNot answered', 'Other participant changed');
for (const node of [...rows, ...bylines]) {
 const box = node.getBoundingClientRect();
 requireFact(box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, 'Creator details are clipped');
}
requireFact(document.documentElement.scrollWidth <= innerWidth, 'Creator details widened viewport');
document.documentElement.dataset.creatorProof = 'pass';
document.documentElement.dataset.fixtureReady = 'creator';
`;

export const executeCreatorProofWithStandIns = (
  html: string,
  width: number
): Document => {
  const document = new DOMParser().parseFromString(html, "text/html");

  const script = document.querySelector(
    "script[data-creator-proof]"
  )?.textContent;

  if (script !== creatorProofScript) {
    throw new Error("Missing exact creator proof");
  }

  for (const node of document.querySelectorAll(
    ".detail-panel li, .detail-panel p"
  )) {
    Object.defineProperty(node, "getBoundingClientRect", {
      value: () => new DOMRect(width - 350, 300, 300, 40),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  runInNewContext(script, { document, innerHeight: 960, innerWidth: width });

  return document;
};
