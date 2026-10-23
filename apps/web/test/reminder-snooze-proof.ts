import { revealReminderSnooze } from "../src/client/reminders/snooze-surface.js";

export const reminderSnoozeProof = `
(() => {
  const requireFact = (ok, text) => { if (!ok) throw Error(text); };
  const reveal = ${revealReminderSnooze.toString()};
  const color = value => {
    const match = value.match(/^rgba?\\(([^)]+)\\)$/);
    requireFact(match, 'Unresolved native proof color');
    const parts = match[1].split(/[,\\s/]+/).map(Number);
    return { rgb: parts.slice(0, 3), alpha: parts[3] ?? 1 };
  };
  const background = element => {
    for (let current = element; current; current = current.parentElement) {
      const parsed = color(getComputedStyle(current).backgroundColor);
      if (parsed.alpha === 0) continue;
      requireFact(parsed.alpha === 1, 'Native proof requires opaque background');
      return parsed.rgb;
    }
    throw Error('Missing native proof background');
  };
  const luminance = rgb => rgb.map(value => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (left, right) => (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
  const evidence = JSON.parse(document.querySelector('#reminder-snooze-evidence').textContent);
  const disclosures = [...document.querySelectorAll('.reminder-card details.reminder-snooze')];
  const disclosure = disclosures.at(-1);
  requireFact(disclosures.length === evidence.cards && disclosure, 'Missing actual reminder cards');
  disclosure.open = true;
  const read = () => {
    requireFact(innerWidth === evidence.width && innerHeight === evidence.height, 'Unexpected snooze viewport');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Snooze fixture widened viewport');
    const stack = disclosure.closest('.reminder-cards');
    reveal(disclosure);
    const bounds = stack.getBoundingClientRect();
    const rect = disclosure.getBoundingClientRect();
    requireFact(rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1, 'Opened last disclosure clipped by stack');
    requireFact(bounds.height <= innerHeight * 0.6 + 1, 'Reminder stack exceeds 60dvh');
    const buttons = [...disclosure.querySelectorAll('button')];
    const labels = buttons.map(button => button.textContent.trim());
    requireFact(JSON.stringify(labels) === JSON.stringify(evidence.labels), 'Unexpected snooze choices');
    requireFact(disclosure.textContent.includes("Snoozes won't be kept after a reload.") === evidence.failed, 'Wrong storage-owned session note');
    for (const target of [disclosure.querySelector('summary'), ...buttons]) {
      const box = target.getBoundingClientRect();
      requireFact(box.width >= 44 && box.height >= 44, 'Snooze target below 44px');
      requireFact(parseFloat(getComputedStyle(target).fontSize) >= 16, 'Snooze text below 16px');
      requireFact(!target.disabled, 'Fixture snooze choice disabled');
      requireFact(box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1, 'Snooze choice clipped by stack');
      requireFact(box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, 'Snooze choice clipped by viewport');
      const style = getComputedStyle(target);
      const bg = luminance(background(target));
      const foreground = color(style.color);
      const border = color(style.borderTopColor);
      requireFact(foreground.alpha === 1 && border.alpha === 1 && Number(style.opacity) === 1, 'Non-opaque snooze target contrast');
      requireFact(contrast(luminance(foreground.rgb), bg) >= 4.5, 'Snooze text contrast below 4.5');
      requireFact(contrast(luminance(border.rgb), bg) >= 3, 'Snooze border contrast below 3');
    }
    if (innerWidth === 390) requireFact(disclosure.getBoundingClientRect().width <= innerWidth, 'Phone snooze menu too wide');
    document.documentElement.dataset.reminderSnoozeProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'reminder-snooze';
  };
  disclosure.addEventListener('toggle', () => { if (disclosure.open) reveal(disclosure); });
  requestAnimationFrame(() => requestAnimationFrame(read));
})();
`;
