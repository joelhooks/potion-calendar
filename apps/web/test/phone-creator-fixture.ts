import { Message, update } from "../src/client/app.js";
import type { AppModel } from "../src/client/app.js";
import { eventKey } from "../src/client/calendar-state.js";
import { creatorEvent, creatorFixture } from "./creator-fixture.js";

export const phoneCreatorFixture = (): AppModel => {
  const base = creatorFixture("attendee");
  const measured = update(base, Message.MeasuredShellViewport({ width: 390 }));

  const opened = update(
    measured.model,
    Message.ClickedEvent({ key: eventKey(creatorEvent()) })
  );

  return {
    ...opened.model,
    calendar: {
      ...opened.model.calendar,
      viewport: 699,
      viewportWidth: 390,
    },
    settings: { ...opened.model.settings, theme: "light" },
  };
};

export const phoneCreatorProofScript = String.raw`
(() => {
  const requireFact = (ok, text) => { if (!ok) throw Error(text); };
  const dialog = document.querySelector('[data-phone-shell-dialog]');
  requireFact(dialog && typeof dialog.showModal === 'function', 'Missing native creator sheet');
  dialog.showModal();
  requestAnimationFrame(() => {
    requireFact(innerWidth === 390 && innerHeight === 844, 'Unexpected creator viewport');
    requireFact(dialog.open && dialog.matches(':modal'), 'Creator sheet is not native modal');
    const header = dialog.querySelector(':scope > header');
    const content = dialog.querySelector(':scope > .phone-panel-content');
    const panel = content.querySelector('.detail-panel');
    requireFact(header.querySelector('h2').textContent === 'Design planning', 'Missing sheet title');
    requireFact(panel.querySelectorAll('h2').length === 0, 'Duplicated details title');
    const rows = [...panel.querySelectorAll('ul li')];
    requireFact(rows.length === 3, 'Creator participant count changed');
    requireFact(rows[0].textContent === 'Alex Rivera · Organizeraccepted', 'Organizer role changed');
    requireFact(rows[1].textContent === 'Blair Chen · You · Creator · Optionaltentative', 'Creator attendee roles or response changed');
    requireFact(rows[2].textContent === 'Casey QuinnneedsAction', 'Other participant changed');
    requireFact(!panel.textContent.includes('Created by '), 'Creator attendee duplicated in byline');
    rows[1].scrollIntoView({ block: 'center' });
    requestAnimationFrame(() => {
      const bounds = dialog.getBoundingClientRect();
      const headerBox = header.getBoundingClientRect();
      const closeBox = header.querySelector('button').getBoundingClientRect();
      const titleBox = header.querySelector('h2').getBoundingClientRect();
      const contentBox = content.getBoundingClientRect();
      requireFact(bounds.left >= -1 && bounds.right <= innerWidth + 1 && Math.abs(bounds.bottom - innerHeight) <= 2, 'Creator sheet is not viewport-aligned');
      requireFact(contentBox.top >= headerBox.bottom - 1 && titleBox.right + 8 <= closeBox.left, 'Creator header overlaps content or close');
      requireFact(closeBox.width >= 43.9 && closeBox.height >= 43.9, 'Creator close target is too small');
      for (const row of rows) {
        const box = row.getBoundingClientRect();
        requireFact(box.width > 0 && box.height > 0 && box.left >= bounds.left && box.right <= bounds.right && box.top >= headerBox.bottom && box.bottom <= bounds.bottom, 'Creator participants are clipped');
      }
      requireFact(document.documentElement.scrollWidth <= innerWidth, 'Creator page widened viewport');
      document.documentElement.dataset.phoneCreatorProof = 'pass';
      document.documentElement.dataset.fixtureReady = 'phone-creator';
    });
  });
})();
`;
