export interface ReminderCardProof {
  readonly width: number;
  readonly kind: "upcoming" | "reminder";
  readonly title: string;
  readonly join: boolean;
  readonly email: boolean;
  readonly notificationCount: number;
  readonly hidden: boolean;
}

export const reminderCardProofScript = (
  evidence: ReminderCardProof
): string => `
const evidence = ${JSON.stringify(evidence).replaceAll("<", "\\u003c")};
if (innerWidth !== evidence.width) throw Error('Wrong review viewport width');
const cards = document.querySelectorAll('.reminder-card');
if (cards.length !== 1) throw Error('Exactly one winning card is required');
const card = cards[0];
const initialFocus = document.activeElement;
if (card.contains(initialFocus) || card.querySelector('[autofocus]')) throw Error('Arrival stole focus');
if (card.querySelector('h2')?.textContent !== evidence.title) throw Error('Wrong event title');
if (!card.textContent.includes(evidence.kind === 'upcoming' ? 'Upcoming meeting' : 'Reminder')) throw Error('Wrong arbitration winner');
const controls = [...card.querySelectorAll('button')];
const labels = controls.map(button => button.textContent.trim());
if (labels.includes('Join') !== evidence.join) throw Error('Wrong conferencing availability');
if (labels.includes('Email participants…') !== evidence.email) throw Error('Wrong mailto availability');
if (!labels.includes('Show') || !labels.includes('Dismiss')) throw Error('Missing card lifecycle actions');
if (evidence.notificationCount !== 1) throw Error('Plain Notification must accompany the card exactly once');
const footer = card.querySelector('.reminder-card-mailto');
if (!!footer !== evidence.email || footer && footer.textContent !== 'Opens your mail app.') throw Error('Wrong conditional mail-app copy');
const measurements = [];
for (const button of controls) {
  if (button.disabled) throw Error('Action is disabled');
  button.focus();
  if (document.activeElement !== button) throw Error('Action cannot receive focus');
  const box = button.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0 || box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1) throw Error('Clipped reminder action');
  measurements.push({label: button.textContent.trim(), left: box.left, right: box.right, top: box.top, bottom: box.bottom});
}
if (document.documentElement.scrollWidth > innerWidth + 1) throw Error('Page widened');
document.activeElement?.blur();
initialFocus?.focus();
if (card.contains(document.activeElement)) throw Error('Proof left the card focused');
document.documentElement.dataset.reminderCardMeasurements = JSON.stringify(measurements);
document.documentElement.dataset.reminderCardProof = 'pass';
`;
