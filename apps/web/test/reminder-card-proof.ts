import { runInNewContext } from "node:vm";

export interface ReminderCardProof {
  readonly width: number;
  readonly kind: "upcoming" | "reminder";
  readonly title: string;
  readonly join: boolean;
  readonly email: boolean;
  readonly notificationCount: number;
  readonly hidden: boolean;
  readonly untilStart: boolean;
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
const disclosures = card.querySelectorAll('details.reminder-snooze');
if (disclosures.length !== 1) throw Error('Exactly one Snooze disclosure is required');
const disclosure = disclosures[0];
if (disclosure.open) throw Error('Snooze disclosure must initially be closed');
if (disclosure.querySelector('summary')?.textContent.trim() !== 'Snooze') throw Error('Wrong Snooze disclosure label');
const snoozeChoices = [...disclosure.querySelectorAll('button')];
const expectedSnoozeLabels = ['1 minute', '5 minutes', '15 minutes', '30 minutes', '60 minutes', '1440 minutes', ...(evidence.untilStart ? ['Until start'] : [])];
if (JSON.stringify(snoozeChoices.map(button => button.textContent.trim())) !== JSON.stringify(expectedSnoozeLabels)) throw Error('Wrong conditional Snooze choices');
if (snoozeChoices.some(button => button.disabled)) throw Error('Steady-state Snooze choices must be enabled');
const controls = [...card.querySelectorAll('button')].filter(button => !button.closest('.reminder-snooze'));
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

export const executeReminderCardProofWithStandInBoxes = (
  document: Document,
  script: string,
  width: number
): void => {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    ".reminder-card button"
  )) {
    button.focus = () => {
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        value: button,
      });
    };

    button.blur = () => {
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        value: document.body,
      });
    };

    button.getBoundingClientRect = () =>
      button.closest("details.reminder-snooze:not([open])") === null
        ? new DOMRect(20, 100, 120, 44)
        : new DOMRect(0, 0, 0, 0);
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  runInNewContext(script, { document, innerHeight: 900, innerWidth: width });
};
