import { runInNewContext } from "node:vm";

export const createTypeProofScript = `
const evidence = JSON.parse(document.querySelector('#create-type-evidence').textContent);
const calendar = evidence.calendar;
if (calendar.accountId !== 'account' || calendar.calendarId !== 'calendar' || calendar.accessRole !== 'owner') throw Error('Wrong identity or writability');
const ineligible = evidence.scene === 'ineligible';
if (calendar.primary !== !ineligible) throw Error('Wrong calendar precondition');
const status = ['focus', 'ooo', 'refused'].includes(evidence.scene);
const expectedType = evidence.scene === 'ooo' ? 'outOfOffice' : status ? 'focusTime' : 'default';
const dialog = document.querySelector('#event-editor-dialog');
if (!dialog) throw Error('Missing create dialog');
if (!dialog.open) dialog.showModal();
const select = dialog.querySelector('#event-type');
if (!select || select.disabled || select.value !== expectedType) throw Error('Wrong or dead type control');
if (dialog.querySelector('[data-status-entitlement]').dataset.statusEntitlement !== (ineligible ? 'ineligible' : 'unknown')) throw Error('Entitlement was invented');
if (dialog.querySelector('#event-title').value !== evidence.title) throw Error('Wrong draft title');
if (dialog.querySelector('#event-allDay').checked) throw Error('Status fixture must be timed');
const posts = evidence.receipts.filter(row => row.request.method === 'POST');
if (posts.length !== (ineligible ? 0 : 1)) throw Error('Unexpected insert count or fallback');
for (const receipt of posts) {
  if (receipt.request.accountId !== calendar.accountId || receipt.request.path !== '/calendars/calendar/events?sendUpdates=none') throw Error('Wrong insert owner or invitation policy');
  const body = JSON.parse(receipt.request.body);
  if (body.id !== evidence.createId || body.summary !== evidence.title || body.attendees.length !== 0) throw Error('Wrong insert identity or guests');
  if (body.start.dateTime !== '2026-10-21T16:00:00.000Z' || body.end.dateTime !== (evidence.scene === 'ooo' ? '2026-10-24T00:00:00.000Z' : '2026-10-21T17:00:00.000Z')) throw Error('Wrong timed date range');
  if (status) {
    const read = evidence.receipts.find(row => row.request.method === 'GET');
    const authoritative = read && JSON.parse(read.response.body);
    if (!authoritative || authoritative.id !== calendar.calendarId || authoritative.primary !== true || authoritative.accessRole !== 'owner') throw Error('Missing authoritative calendar precondition');
    const property = expectedType === 'focusTime' ? 'focusTimeProperties' : 'outOfOfficeProperties';
    const other = expectedType === 'focusTime' ? 'outOfOfficeProperties' : 'focusTimeProperties';
    if (body.eventType !== expectedType || body.transparency !== 'opaque' || body[property]?.autoDeclineMode !== 'declineNone' || Object.keys(body[property]).length !== 1 || body[other] !== undefined || body.conferenceData !== undefined) throw Error('Invalid status insert properties');
    if (dialog.querySelector('#event-status-invitations').checked) throw Error('Automatic decline must be unticked by default');
    if (!dialog.textContent.includes('Decline new invitations during this time') || !dialog.textContent.includes('Focus time and Out of office have no guests. Saving sends no invitation emails.')) throw Error('Missing plain invitation policy');
  } else if (body.eventType !== undefined && body.eventType !== 'default') throw Error('Event is not the default');
  if (evidence.scene === 'refused') {
    if (receipt.response.status !== 403 || evidence.createdCount !== 0 || JSON.stringify(evidence.beforeDraft) !== JSON.stringify(evidence.afterDraft)) throw Error('Refusal did not preserve draft or created an event');
    if (!dialog.textContent.includes("Google didn't accept a Focus time event for this account. Nothing was created.") || !dialog.querySelector('#event-save-as-event')) throw Error('Missing honest refusal and explicit fallback');
  } else {
    const created = JSON.parse(receipt.response.body);
    if (receipt.response.status !== 200 || created.id !== body.id || created.eventType !== expectedType || evidence.createdCount !== 1) throw Error('Missing accepted fake-Google receipt');
  }
}
if (ineligible) {
  for (const type of ['focusTime', 'outOfOffice']) if (!select.querySelector('option[value="' + type + '"]').disabled) throw Error('Ineligible status option is enabled');
  if (dialog.querySelector('#event-type-reason')?.textContent !== 'Focus time and Out of office only work on your primary calendar.') throw Error('Missing disabled reason');
}
if (evidence.scene === 'ooo' && (dialog.querySelector('#event-startDate').value !== '2026-10-21' || dialog.querySelector('#event-endDate').value !== '2026-10-23')) throw Error('Wrong multi-day OOO range');
const controls = [select, dialog.querySelector('#event-startDate'), dialog.querySelector('#event-endDate'), dialog.querySelector('#event-editor-dialog-confirm')];
if (status) controls.push(dialog.querySelector('#event-status-invitations'));
if (evidence.scene === 'refused') controls.push(dialog.querySelector('#event-save-as-event'));
const measurements = [];
for (const control of controls) {
  if (!control || control.disabled) throw Error('Missing usable control');
  control.scrollIntoView({block: 'nearest'});
  control.focus();
  if (document.activeElement !== control) throw Error('Control cannot receive focus');
  const box = control.getBoundingClientRect();
  const frame = dialog.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0 || box.left < frame.left - 1 || box.right > frame.right + 1 || box.top < -1 || box.bottom > innerHeight + 1 || frame.left < -1 || frame.right > innerWidth + 1 || frame.top < -1 || frame.bottom > innerHeight + 1) throw Error('Clipped create control');
  measurements.push({id: control.id, left: box.left, top: box.top, right: box.right, bottom: box.bottom});
}
if (document.documentElement.scrollWidth > innerWidth + 1) throw Error('Page widened');
const final = evidence.scene === 'refused' ? dialog.querySelector('#event-save-as-event') : select;
final.scrollIntoView({block: 'nearest'});
final.focus();
document.documentElement.dataset.createTypeMeasurements = JSON.stringify(measurements);
document.documentElement.dataset.createTypeProof = 'pass';
`;

export const executeCreateTypeProofWithStandInBoxes = (
  html: string,
  width: number
) => {
  const frame = globalThis.document.createElement("iframe");
  globalThis.document.body.append(frame);
  const document = frame.contentDocument;

  if (document === null) {
    frame.remove();
    throw new Error("Missing proof document");
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

  const scrolledControls: string[] = [];

  for (const element of document.querySelectorAll("*")) {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () =>
        element === dialog
          ? new DOMRect(width / 2 - 300, 50, 600, 800)
          : new DOMRect(width / 2 - 200, 300, 200, 30),
    });
    Object.defineProperty(element, "scrollIntoView", {
      value: () => scrolledControls.push(element.id),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  const script = document.querySelector("#create-type-proof")?.textContent;

  if (script === undefined || script === null || script === "") {
    frame.remove();
    throw new Error("Missing exported proof script");
  }

  try {
    runInNewContext(script, { document, innerHeight: 900, innerWidth: width });
  } finally {
    frame.remove();
  }

  document.documentElement.dataset.standInScrolls =
    JSON.stringify(scrolledControls);

  return document;
};
