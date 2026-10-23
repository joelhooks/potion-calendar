import { runInNewContext } from "node:vm";

export const phoneDialogsProofScript = String.raw`
const requireFact = (ok, message) => { if (!ok) throw Error(message); };
const evidence = JSON.parse(document.querySelector('#phone-dialogs-evidence').textContent);
requireFact(document.querySelector('#phone-dialog-styles'), 'Missing phone styles');
const selectors = { command: '#keyboard-command-dialog', editor: 'dialog[data-editing-dialog]', settings: '#phone-settings-dialog', search: '#phone-search-dialog' };
const dialog = document.querySelector(selectors[evidence.surface]);
requireFact(dialog, 'Missing actual phone dialog');
if (!dialog.open) dialog.showModal();
const box = dialog.getBoundingClientRect();
requireFact(Math.abs(box.left) <= 1 && Math.abs(box.top) <= 1 && Math.abs(box.width - innerWidth) <= 1 && Math.abs(box.height - innerHeight) <= 1, 'Dialog is not a full-screen sheet');
const header = dialog.querySelector('header');
const close = header && header.querySelector('button[aria-label]');
requireFact(close && close.getAttribute('aria-label').startsWith('Close'), 'Missing sheet close control');
const closeBox = close.getBoundingClientRect();
requireFact(closeBox.width >= 44 && closeBox.height >= 44 && closeBox.right <= innerWidth && closeBox.top >= 0, 'Close control is clipped or too small');
const scrollers = { command: '#keyboard-choices', editor: '.editor-scroll', settings: '.settings-content', search: '#search-results' };
const body = dialog.querySelector(scrollers[evidence.surface]);
requireFact(body && ['auto', 'scroll'].includes(getComputedStyle(body).overflowY), 'Missing scrolling sheet body');
for (const input of dialog.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea')) {
 requireFact(parseFloat(getComputedStyle(input).fontSize) >= 16, 'Input text is below 16px');
}
for (const target of dialog.querySelectorAll('button, a[href], label:has(input[type="checkbox"], input[type="radio"])')) {
 const targetBox = target.getBoundingClientRect();
 if (targetBox.width > 0 && targetBox.height > 0) requireFact(targetBox.width >= 44 && targetBox.height >= 44, 'Sheet tap target is below 44px: ' + (target.getAttribute('aria-label') || target.textContent));
}
if (evidence.surface === 'command') {
 requireFact(matchMedia('(pointer: coarse)').matches, 'Phone review needs a coarse pointer');
 const hints = dialog.querySelectorAll('[data-command-trigger-hint], #keyboard-choices button > span:last-child, footer');
 requireFact(hints.length > 2 && Array.from(hints).every(hint => getComputedStyle(hint).display === 'none'), 'Keyboard hints are visible on a coarse pointer');
 requireFact(dialog.querySelectorAll('#keyboard-choices button').length > 0, 'Commands were removed with their hints');
}
if (evidence.surface === 'editor') {
 const title = dialog.querySelector('#event-title');
 requireFact(title && title.value.length > 60, 'Missing long event title');
 const fields = ['startDate', 'endDate', 'startTime', 'endTime'].map(name => dialog.querySelector('#event-' + name));
 requireFact(fields.every(Boolean), 'Missing date or time field');
 const footer = dialog.querySelector('.editor-footer');
 requireFact(footer && !body.contains(footer), 'Editor actions scroll with the body');
 const footerBox = footer.getBoundingClientRect();
 requireFact(footerBox.top >= box.top && footerBox.bottom <= innerHeight, 'Editor footer is outside the sheet');
 for (const field of [title, ...fields]) {
  const fieldBox = field.getBoundingClientRect();
  requireFact(fieldBox.width > 0 && fieldBox.left >= 0 && fieldBox.right <= innerWidth && fieldBox.top >= header.getBoundingClientRect().bottom && fieldBox.bottom <= footerBox.top, 'Date, time or title field is clipped');
 }
}
if (evidence.surface === 'search') {
 requireFact(dialog.querySelectorAll('[data-search-event]').length === 20, 'Missing held search results');
 body.scrollTop = body.scrollHeight;
 const more = Array.from(body.querySelectorAll('button')).find(button => button.textContent.trim() === 'Load more');
 requireFact(more && !more.disabled, 'Missing healthy load-more footer');
 const moreBox = more.getBoundingClientRect();
 requireFact(moreBox.width > 0 && moreBox.left >= 0 && moreBox.right <= innerWidth && moreBox.bottom <= innerHeight && moreBox.top >= header.getBoundingClientRect().bottom, 'Load-more footer is clipped');
}
requireFact(document.documentElement.scrollWidth <= innerWidth, 'Phone dialog widened the page');
document.documentElement.dataset.phoneDialogsProof = 'pass';
document.documentElement.dataset.fixtureReady = 'phone-dialogs';
`;

export const executePhoneDialogsProofWithStandIns = (
  html: string,
  width: number,
  height: number
): Document => {
  const document = new DOMParser().parseFromString(html, "text/html");

  const script = document.querySelector(
    "script[data-phone-dialogs-proof]"
  )?.textContent;

  if (script !== phoneDialogsProofScript) {
    throw new Error("Missing exact phone dialogs proof");
  }

  for (const dialog of document.querySelectorAll("dialog")) {
    Object.defineProperty(dialog, "showModal", {
      value: () => {
        dialog.setAttribute("open", "");
      },
    });
  }

  const bounds = (node: Element): DOMRect => {
    if (node.matches("dialog")) {
      return new DOMRect(0, 0, width, height);
    }

    if (node.matches("header")) {
      return new DOMRect(0, 0, width, 72);
    }

    if (node.matches("header button")) {
      return new DOMRect(width - 60, 12, 44, 44);
    }

    if (node.matches("footer, .editor-footer")) {
      return new DOMRect(0, height - 84, width, 84);
    }

    const fields = [
      "event-title",
      "event-startDate",
      "event-endDate",
      "event-startTime",
      "event-endTime",
    ];

    const index = fields.indexOf(node.id);

    if (index !== -1) {
      return new DOMRect(16, 90 + index * 70, width - 32, 44);
    }

    return new DOMRect(16, height - 140, width - 32, 44);
  };

  for (const node of document.querySelectorAll("*")) {
    Object.defineProperty(node, "getBoundingClientRect", {
      value: () => bounds(node),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  runInNewContext(script, {
    document,
    getComputedStyle: (node: Element) => ({
      display: node.matches(
        "[data-command-trigger-hint], #keyboard-choices button > span:last-child, #keyboard-command-dialog > footer"
      )
        ? "none"
        : "block",
      fontSize: "16px",
      overflowY: "auto",
    }),
    innerHeight: height,
    innerWidth: width,
    matchMedia: () => ({ matches: true }),
  });

  return document;
};
