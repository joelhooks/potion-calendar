import { runInNewContext } from "node:vm";

export const modDeleteProofScript = `
const e = JSON.parse(document.querySelector('#mod-delete-evidence').textContent);
const assert = (condition, message) => { if (!condition) throw Error(message); };
assert(e.loaded && e.source && e.calendar && e.selected.length > 0, 'Missing loaded source precondition');
assert(e.calendar.accessRole === 'owner' && e.source.eventType === 'default', 'Wrong eligibility precondition');
assert(e.selected.includes(JSON.stringify([e.source.accountId,e.source.calendarId,e.source.eventId])), 'Wrong saved selection');
assert(e.mutations.length === 0, 'Provider mutation before commit');
assert(!e.views.some(tag => ['Email','Scope','RemoveRecurrence','Failure'].includes(tag)), 'Unexpected confirmation or failure');
assert(!document.querySelector('dialog[data-editing-dialog]'), 'Unexpected editor dialog');
const bounded = (element) => {
 assert(element, 'Missing visible UI');
 const b = element.getBoundingClientRect();
 assert(b.width > 0 && b.height > 0 && b.left >= -1 && b.right <= innerWidth + 1 && b.top >= -1 && b.bottom <= innerHeight + 1, 'Clipped packet UI');
};
if (e.scenario === 'shortcuts' || e.scenario === 'catalog') {
 if (e.scenario === 'catalog') {
  const dialog = document.querySelector('#keyboard-command-dialog');
  assert(dialog, 'Missing command dialog');
  if (!dialog.open) dialog.showModal();
  assert(dialog.open && dialog.matches(':modal'), 'Command dialog is not modal');
 }
 const selector = e.scenario === 'shortcuts' ? '[data-shortcut-id="delete-instantly"]' : '#command-delete-instantly';
 const row = document.querySelector(selector);
 bounded(row);
 assert(row.textContent.includes('Delete instantly') && row.textContent.includes('⌘⌫'), 'Missing instant deletion advertisement');
 const twin = document.querySelector(e.scenario === 'shortcuts' ? '[data-shortcut-id="delete-no-email"]' : '#command-delete-no-email');
 bounded(twin);
 assert(e.pending.length === 0, 'Listing staged a deletion');
} else {
 assert(e.pending.length === (e.scenario === 'mixed' ? 2 : 1), 'Wrong staged count');
 for (const mark of e.pending) assert(mark.request.sendUpdates === 'all' && mark.request.scope === 'single' && mark.request.eventId === mark.event.eventId, 'Wrong instant delete request');
 const notice = document.querySelector(e.scenario === 'mixed' ? '[aria-label="Bulk action results"]' : '.undo-toast');
 bounded(notice);
 assert(notice.textContent.includes(e.expected), 'Wrong staged role or email wording');
 assert(!notice.textContent.includes('guests notified') && !notice.textContent.includes('email sent to'), 'Premature sent claim');
 if(e.scenario === 'mixed') {
  assert(notice.textContent.includes('Deleted 2 events') && notice.textContent.includes("Couldn't delete 1 event"), 'Partial result missing');
  assert(e.pending.some(mark => !(mark.event.attendees ?? []).some(person => person.self !== true)), 'No no-guest member');
 } else {
  assert(notice.dataset.undoIntent === e.pending[0].id, 'Wrong Undo identity');
  assert([...notice.querySelectorAll('button')].some(button => button.textContent === 'Undo'), 'Missing Undo');
 }
 for(const button of notice.querySelectorAll('button')) bounded(button);
 if(e.scenario === 'organizer-repeat') {
  assert(e.source.recurringEventId && e.source.originalStartTime, 'Not a selected recurring occurrence');
  assert([...document.querySelectorAll('.event-chip')].some(chip => chip.dataset.eventKey === e.companion), 'Other occurrence disappeared');
 }
 if(e.scenario === 'no-guests') assert(!e.source.attendees.some(person => person.self !== true), 'No-guest fixture has guests');
 assert(!notice.contains(document.activeElement), 'Proof or arrival left notice focused');
}
assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Page widened');
document.documentElement.dataset.modDeleteProof = 'pass';
`;

export const executeModDeleteProofWithStandInBoxes = (
  html: string,
  width: number,
  presentation: "modal" | "closed" | "nonmodal" = "modal"
) => {
  const document = new DOMParser().parseFromString(html, "text/html");

  const dialog = document.querySelector<HTMLDialogElement>(
    "#keyboard-command-dialog"
  );

  if (dialog !== null) {
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
  }

  for (const element of document.querySelectorAll("*")) {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => new DOMRect(24, 160, Math.min(width - 48, 600), 48),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });

  const script = document.querySelector(
    "script[data-mod-delete-proof]"
  )?.textContent;

  if (script === undefined || script === null) {
    throw new Error("Missing exact packet proof");
  }

  runInNewContext(script, {
    URL,
    document,
    innerHeight: 960,
    innerWidth: width,
  });

  return document;
};
