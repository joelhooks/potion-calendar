import { runInNewContext } from "node:vm";

export const statusFidelityProofScript = `
const evidence = JSON.parse(document.querySelector('#status-fidelity-evidence').textContent);
const source = evidence.source;
const calendar = evidence.calendar;
const create = evidence.scene === 'focus-create';
const editor = create || evidence.scene.endsWith('editor');
const type = evidence.scene.startsWith('ooo') ? 'outOfOffice' : 'focusTime';
if (source.accountId !== 'account' || source.calendarId !== 'calendar' || calendar.accountId !== source.accountId || calendar.calendarId !== source.calendarId || source.organizer?.self !== true || calendar.accessRole !== 'owner' || calendar.primary !== true) throw Error('Missing owner identity and writable primary preconditions');
if (source.eventType !== type || !source.eventId || !source.start?.dateTime || !source.end?.dateTime) throw Error('Missing saved source type or timed range');
const property = type === 'focusTime' ? 'focusTimeProperties' : 'outOfOfficeProperties';
const mode = source[property]?.autoDeclineMode;
const patches = evidence.receipts.filter(row => row.request.method === 'PATCH');
const posts = evidence.receipts.filter(row => row.request.method === 'POST');
if (!create) {
  const read = evidence.receipts.find(row => row.request.method === 'GET' && row.request.path === '/calendars/calendar/events/' + source.eventId);
  const saved = read && JSON.parse(read.response.body);
  if (!read || read.response.status !== 200 || saved.id !== source.eventId || saved.eventType !== type || saved.organizer?.self !== true) throw Error('Missing authoritative saved source receipt');
  if (!source.attendees?.length || !source.attachments?.length || !source.location || !source.description || !source.conferenceUrl) throw Error('Omission fixture lacks adversarial ordinary-field preconditions');
  const key = JSON.stringify([source.accountId, source.calendarId, source.eventId]);
  if (![...document.querySelectorAll('.event-chip.selected')].some(node => node.dataset.eventKey === key)) throw Error('Source is not actually selected');
}
let panel;
let targets;
if (editor) {
  panel = document.querySelector('#event-editor-dialog');
  if (!panel) throw Error('Missing editor');
  if (!panel.open) panel.showModal();
  for (const id of ['event-location', 'event-description', 'event-links', 'event-participantEmail', 'event-add-meet', 'event-remove-conferencing']) if (panel.querySelector('#' + id)) throw Error('Omitted status editor section is present: ' + id);
  const title = panel.querySelector('#event-title');
  const box = panel.querySelector('#event-status-invitations');
  if (!title || title.disabled || title.value !== evidence.expectedTitle || !box) throw Error('Wrong writable title or missing policy control');
  if (!create) {
    if (panel.querySelector('#event-type') || panel.querySelector('[data-saved-event-type]')?.dataset.savedEventType !== type) throw Error('Saved type is not read-only');
    if (box.checked !== (mode !== 'declineNone' && mode !== undefined)) throw Error('Saved decline mode was not prefilled');
    if (mode === 'declineAllConflictingInvitations') {
      if (!box.disabled || panel.querySelector('#event-status-policy-readonly')?.textContent !== 'Google is set to decline all conflicting invitations. Change this in Google Calendar.') throw Error('Unsupported policy is editable or unexplained');
    } else if (box.disabled) throw Error('Supported owner policy became a dead control');
  } else {
    if (panel.querySelector('#event-type')?.value !== 'focusTime' || box.checked || box.disabled) throw Error('Wrong Focus create default');
    if (posts.length !== 1 || posts[0].response.status !== 200) throw Error('Missing accepted Focus insert');
    const request = posts[0].request;
    const body = JSON.parse(request.body);
    const saved = JSON.parse(posts[0].response.body);
    if (request.accountId !== source.accountId || request.path !== '/calendars/calendar/events?sendUpdates=none' || body.eventType !== 'focusTime' || body.focusTimeProperties?.autoDeclineMode !== 'declineNone' || body.transparency !== 'opaque' || body.attendees.length !== 0 || saved.id !== body.id || saved.eventType !== 'focusTime') throw Error('Wrong Focus insert policy or saved type');
    const read = evidence.receipts.find(row => row.request.method === 'GET');
    const primary = read && JSON.parse(read.response.body);
    if (!primary || primary.id !== calendar.calendarId || primary.primary !== true || primary.accessRole !== 'owner') throw Error('Missing authoritative create calendar precondition');
  }
  if (evidence.scene === 'focus-editor') {
    if (mode !== 'declineAllConflictingInvitations' || patches.length !== 1) throw Error('Title fixture lacks unsupported saved policy or PATCH');
    const receipt = patches[0];
    const body = JSON.parse(receipt.request.body);
    const updated = JSON.parse(receipt.response.body);
    if (receipt.request.accountId !== source.accountId || receipt.request.path !== '/calendars/calendar/events/' + source.eventId + '?sendUpdates=none' || receipt.response.status !== 200 || JSON.stringify(Object.keys(body)) !== JSON.stringify(['summary']) || body.summary !== evidence.expectedTitle || updated.eventType !== type || JSON.stringify(updated[property]) !== JSON.stringify(source[property])) throw Error('Title-only PATCH rewrote type, properties or invitation policy');
  } else if (patches.length !== 0) throw Error('Unexpected status PATCH');
  targets = [panel.querySelector('[aria-label="Event type"]'), box, title, panel.querySelector('#event-startDate'), panel.querySelector('#event-endDate'), panel.querySelector('#event-editor-dialog-confirm')];
  if (mode === 'declineAllConflictingInvitations') targets.push(panel.querySelector('#event-status-policy-readonly'));
} else {
  panel = document.querySelector('.detail-panel');
  if (!panel || panel.querySelector('[data-saved-event-type]')?.dataset.savedEventType !== type) throw Error('Missing status details');
  for (const selector of ['.event-rsvp', '.email-participants', '.join-link', 'a']) if (panel.querySelector(selector)) throw Error('Omitted details section is present: ' + selector);
  if (JSON.stringify([...panel.querySelectorAll('h3')].map(node => node.textContent)) !== JSON.stringify(['Calendar']) || panel.textContent.includes('Private notes') || panel.textContent.includes('Casey')) throw Error('Ordinary details leaked');
  const time = (panel.querySelector('.detail-date')?.textContent ?? '') + (panel.querySelector('.detail-time')?.textContent ?? '');
  if (!time.includes('9am') || !time.includes(type === 'outOfOffice' ? '5pm' : '10am')) throw Error('Missing actual time range');
  const key = JSON.stringify([source.accountId, source.calendarId]);
  if (panel.querySelector('.detail-calendar')?.dataset.calendarKey !== key) throw Error('Wrong source calendar');
  const decline = panel.querySelector('.detail-status-policy');
  if (mode !== undefined && mode !== 'declineNone' ? decline?.textContent !== 'Declines new invitations during this time.' : decline !== null) throw Error('Wrong read-only decline summary');
  if (patches.length || posts.length) throw Error('Read-only scene wrote data');
  const edit = [...panel.querySelectorAll('button')].find(node => node.textContent === 'Edit');
  if (!edit || edit.disabled) throw Error('Owner Edit is disabled');
  targets = [panel.querySelector('[data-saved-event-type]'), panel.querySelector('.detail-date'), panel.querySelector('.detail-calendar'), edit];
  if (decline) targets.push(decline);
}
const measurements = [];
for (const target of targets) {
  if (!target) throw Error('Missing asserted status field');
  target.scrollIntoView({ block: 'nearest' });
  const box = target.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0 || box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1 || bounds.left < -1 || bounds.right > innerWidth + 1 || bounds.top < -1 || bounds.bottom > innerHeight + 1) throw Error('Asserted field is outside its panel');
  if (target.matches('input,button,select') && !target.disabled) { target.focus(); if (document.activeElement !== target) throw Error('Writable field cannot receive focus'); }
  measurements.push({id: target.id, text: target.textContent?.slice(0, 80), left: box.left, right: box.right, top: box.top, bottom: box.bottom});
}
if (document.documentElement.scrollWidth > innerWidth + 1) throw Error('Page overflow');
if (editor) { const title = panel.querySelector('#event-title'); title.scrollIntoView({block: 'nearest'}); title.focus(); } else panel.scrollTop = 0;
document.documentElement.dataset.statusFidelityMeasurements = JSON.stringify(measurements);
document.documentElement.dataset.statusFidelityProof = 'pass';
`;

export const executeStatusFidelityProofWithStandInBoxes = (
  html: string,
  width: number
) => {
  const frame = globalThis.document.createElement("iframe");
  globalThis.document.body.append(frame);
  const document = frame.contentDocument;

  if (document === null) {
    frame.remove();
    throw new Error("Missing status proof document");
  }

  document.documentElement.innerHTML = new DOMParser().parseFromString(
    html,
    "text/html"
  ).documentElement.innerHTML;
  const dialog = document.querySelector("dialog");

  if (dialog !== null) {
    Object.defineProperty(dialog, "showModal", {
      value: () => {
        dialog.setAttribute("open", "");
      },
    });
  }

  const scrolls: string[] = [];

  for (const element of document.querySelectorAll("*")) {
    Object.defineProperty(element, "scrollIntoView", {
      value: () => scrolls.push(element.id),
    });
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => {
        if (element.matches(".detail-panel")) {
          return new DOMRect(width - 300, 90, 280, 790);
        }

        if (element.closest(".detail-panel")) {
          return new DOMRect(width - 280, 250, 220, 30);
        }

        if (element === dialog) {
          return new DOMRect(width / 2 - 300, 60, 600, 780);
        }

        return new DOMRect(width / 2 - 230, 250, 220, 30);
      },
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  const script = document.querySelector("#status-fidelity-proof")?.textContent;

  if (script === null || script === undefined || script === "") {
    frame.remove();
    throw new Error("Missing exported status proof script");
  }

  try {
    runInNewContext(script, { document, innerHeight: 900, innerWidth: width });
  } finally {
    frame.remove();
  }

  document.documentElement.dataset.standInScrolls = JSON.stringify(scrolls);

  return document;
};
