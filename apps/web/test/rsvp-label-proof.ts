export const responseLabelProofScript = `(() => {
  const standIn = window.__JSDOM_STAND_IN__ === true;
  const requireFact = (condition, message) => { if (!condition) throw new Error(message); };
  const dialog = document.querySelector('[data-phone-shell-dialog]');
  if (dialog && !dialog.open) {
    if (standIn) dialog.setAttribute('open', '');
    else dialog.showModal();
  }
  const rows = [...document.querySelectorAll('.attendee-response')];
  const expected = ['Yes', 'No', 'Maybe', 'Not answered', 'Not answered'];
  requireFact(JSON.stringify(rows.map(row => row.textContent)) === JSON.stringify(expected), 'Participant answers differ');
  requireFact(rows.every((row, index) => row.parentElement.querySelector('strong').textContent === 'Guest ' + (index + 1)), 'Participant identities differ');
  requireFact(rows[0].parentElement.textContent.includes('You'), 'Self role missing');
  requireFact(rows[1].parentElement.textContent.includes('Organizer'), 'Organizer role missing');
  requireFact(rows[2].parentElement.textContent.includes('Optional'), 'Optional role missing');
  requireFact(rows.every(row => !row.hasAttribute('aria-label') || row.getAttribute('aria-label') === row.textContent), 'Answer aria label differs');
  const choices = [...document.querySelectorAll('.event-rsvp button')];
  requireFact(JSON.stringify(choices.map(button => button.textContent)) === JSON.stringify(['Yes','No','Maybe']), 'RSVP choice labels differ');
  requireFact(choices[0].getAttribute('aria-pressed') === 'true', 'Accepted self response lost');
  requireFact(document.querySelector('.event-chip').getAttribute('aria-label').endsWith(', accepted'), 'Derived chip aria changed');
  if (!standIn) requireFact(document.documentElement.scrollWidth <= window.innerWidth, 'Page has horizontal overflow');
  window.__rsvpLabelEvidence = { participantLabels: rows.map(row => row.textContent), identities: rows.map(row => row.parentElement.textContent), choices: choices.map(button => button.textContent), chipAria: document.querySelector('.event-chip').getAttribute('aria-label'), phoneSheetOpen: dialog ? dialog.open : false, qualification: standIn ? 'JSDOM stand-in; not browser proof' : 'browser' };
  document.documentElement.dataset.rsvpLabelProof = standIn ? 'JSDOM stand-in; not browser proof' : 'browser';
  document.documentElement.dataset.fixtureReady = 'rsvp-labels';
})();`;
