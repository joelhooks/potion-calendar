import { runInNewContext } from "node:vm";

export const participantProofScript = String.raw`
const evidence = JSON.parse(document.querySelector('#participant-evidence').textContent);
const requireFact = (ok, text) => { if (!ok) throw new Error(text); };
requireFact(evidence.person === 'fixture-person' && evidence.identity === 'owner@example.test' && evidence.loaded, 'Missing identity and loaded source preconditions');
const attendees = evidence.source.attendees;
requireFact(Array.isArray(attendees), 'Missing attendee role precondition');
requireFact(evidence.source.title === 'Weekly sync' && evidence.selected.length === 1, 'Missing selected meeting precondition');
const solo = evidence.scene === 'solo';
if (solo) requireFact(attendees.length === 0, 'Missing solo precondition');
else {
  requireFact(attendees.length === 5 && attendees.filter(a => a.self === true).length === 1 && attendees.filter(a => a.resource === true).length === 1 && attendees.filter(a => !a.self && !a.resource).length === 3, 'Missing human, self and room preconditions');
  requireFact(attendees.find(a => a.self)?.email === evidence.identity && evidence.source.organizer.self === false, 'Missing source role precondition');
}
requireFact(evidence.source.guestsCanSeeOtherGuests === (evidence.scene !== 'hidden') && evidence.source.attendeesOmitted === (evidence.scene === 'omitted'), 'Missing visibility precondition');
const root = document.querySelector('.detail-panel');
requireFact(root && root.textContent.includes('Weekly sync'), 'Missing selected meeting details');
const heading = root.querySelector('#participant-heading');
requireFact(heading && heading.textContent === 'Attendees', 'Missing participant heading');
heading.scrollIntoView({block: 'start', inline: 'nearest', container: 'nearest'});
const button = [...root.querySelectorAll('button')].find(b => b.textContent === 'Email participants');
requireFact(button, 'Missing participant button');
const ready = evidence.scene === 'button' || evidence.scene === 'keyboard';
requireFact(button.disabled === !ready && evidence.availability === (ready ? 'enabled' : 'disabled'), 'Wrong button or command eligibility');
if (ready) {
  const expected = 'mailto:Alex@example.test,blair%2Bdesign@example.test,casey@example.test?subject=Weekly%20sync';
  requireFact(evidence.directHref === expected && evidence.keyHref === expected, 'Wrong captured mailto');
  requireFact(evidence.commands.length === 1 && evidence.commands[0] === 'FollowRouteRequest', 'Unexpected send or provider command');
  const target = new URL(evidence.directHref);
  requireFact(target.protocol === 'mailto:' && target.searchParams.get('subject') === 'Weekly sync' && !target.searchParams.has('body'), 'Wrong mail workflow');
  requireFact(!evidence.directHref.includes('owner@') && !evidence.directHref.includes('resource.calendar'), 'Self or room recipient leak');
} else {
  requireFact(evidence.directHref === null && evidence.keyHref === null && evidence.commands.length === 0, 'Ineligible action opened a URL');
  if (evidence.scene === 'hidden') requireFact(root.textContent.includes('The organizer has hidden the guest list.'), 'Missing hidden-list reason');
  if (evidence.scene === 'omitted') requireFact(root.textContent.includes("Google didn't send the full guest list."), 'Missing incomplete-list reason');
}
requireFact(evidence.navigated === false, 'Fixture navigated a mailto');
const panel = root.getBoundingClientRect();
const visible = (node) => { const bounds = node.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0 && bounds.left >= Math.max(0, panel.left) && bounds.right <= Math.min(innerWidth, panel.right) && bounds.top >= Math.max(0, panel.top) && bounds.bottom <= Math.min(innerHeight, panel.bottom); };
requireFact(visible(button), 'Participant button is clipped');
if (evidence.scene === 'hidden' || evidence.scene === 'omitted') {
  const reason = root.querySelector('.email-participants p');
  requireFact(reason && visible(reason), 'Participant refusal reason is clipped');
}
requireFact(document.documentElement.scrollWidth <= innerWidth && root.scrollWidth <= root.clientWidth + 1, 'Participant content overflows');
document.documentElement.dataset.participantEmailProof = 'pass';
document.documentElement.dataset.fixtureReady = 'email-participants';
`;

export const hiddenParticipantProofScript = participantProofScript
  .replace(
    "attendees.length === 5 && attendees.filter(a => a.self === true).length === 1 && attendees.filter(a => a.resource === true).length === 1 && attendees.filter(a => !a.self && !a.resource).length === 3",
    "attendees.length === 2 && attendees.filter(a => a.self === true).length === 1 && attendees.filter(a => a.organizer === true).length === 1 && attendees.every(a => a.self === true || a.organizer === true)"
  )
  .replace(
    "document.documentElement.dataset.participantEmailProof = 'pass';",
    "const rows = [...root.querySelectorAll('li')]; requireFact(rows.length === 2 && rows.every(row => row.textContent.includes(' · You') || row.textContent.includes(' · Organizer')), 'Hidden scene rendered an undisclosed guest'); document.documentElement.dataset.participantEmailProof = 'pass';"
  );

export const executeParticipantProofWithStandInBoxes = (
  html: string,
  width: number,
  clipped?: "button" | "reason"
): Document => {
  const document = new DOMParser().parseFromString(html, "text/html");

  const clippedSelector =
    clipped === undefined
      ? "[data-no-stand-in-target]"
      : {
          button: ".email-participants button",
          reason: ".email-participants p",
        }[clipped];

  for (const element of document.querySelectorAll("*")) {
    Object.defineProperty(element, "scrollIntoView", { value: () => false });
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () =>
        element.matches(clippedSelector)
          ? new DOMRect(width - 10, 200, 5, 32)
          : new DOMRect(width - 250, 200, 220, 32),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });

  const script = document.querySelector(
    "script[data-participant-proof]"
  )?.textContent;

  if (script === undefined || script === null) {
    throw new Error("Missing exact participant proof");
  }

  runInNewContext(script, {
    URL,
    document,
    innerHeight: 960,
    innerWidth: width,
  });

  if (document.documentElement.dataset.participantEmailProof !== "pass") {
    throw new Error("Participant proof did not finish");
  }

  return document;
};
