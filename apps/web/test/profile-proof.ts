export const profileProof = String.raw`(() => {
  const requireFact = (ok, message) => { if (!ok) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#profile-evidence').textContent);
  const phone = document.querySelector('#phone-settings-dialog');
  const discard = document.querySelector('#profile-discard-dialog');
  if (phone) phone.showModal();
  if (discard) {
    discard.showModal();
    document.querySelector('#profile-continue').focus();
  }
  requestAnimationFrame(() => {
    requireFact(innerWidth === evidence.width && innerHeight === 900, 'Unexpected profile fixture viewport');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Profile widened the viewport');
    requireFact(evidence.route === '/settings/profile', 'Fixture is not on the Profile route');
    requireFact(document.querySelector('.settings-content h1')?.textContent === 'Profile', 'Profile heading missing');
    requireFact(document.querySelector('.settings-nav a[aria-current="page"]')?.getAttribute('href') === '/settings/profile', 'Profile navigation identity changed');
    requireFact(document.querySelector('img') === null, 'Review fixture must use the identity fallback');
    requireFact(document.querySelector('.profile-avatar')?.textContent === evidence.initials, 'Identity fallback differs from the saved identity');
    const input = document.querySelector('#profile-name');
    const form = document.querySelector('.settings-profile-form');
    const update = [...form.querySelectorAll('button')].find(node => node.textContent === 'Update');
    const cancel = [...form.querySelectorAll('button')].find(node => node.textContent === 'Cancel');
    requireFact(input && input.value === evidence.draft, 'Profile draft differs from the real Model');
    requireFact(input.name === 'name' && input.type === 'text', 'Profile field is not the name-only editor');
    requireFact(cancel && !cancel.disabled, 'Cancel must remain available');
    requireFact(update && update.disabled === (evidence.mode !== 'editing'), 'Update enablement differs from the lifecycle');
    if (evidence.width === 390) {
      requireFact(phone && phone.open && phone.matches(':modal'), 'Phone settings must be a native modal');
    } else {
      requireFact(phone === null, 'Desktop fixture unexpectedly uses a phone sheet');
    }
    if (evidence.scene === 'pristine') {
      requireFact(!input.disabled && input.value === evidence.savedName, 'Pristine name must match persisted identity');
      requireFact(form.querySelector('[role="alert"]') === null, 'Pristine profile has an error');
    }
    if (evidence.scene === 'invalid') {
      requireFact(input.getAttribute('aria-invalid') === 'true', 'Invalid name is not identified accessibly');
      requireFact(document.querySelector('#profile-name-error')?.textContent === 'Full name is required.', 'Required-name error missing');
      requireFact(!input.disabled, 'Invalid name cannot be corrected');
    }
    if (evidence.scene === 'saving') {
      requireFact(input.disabled && update.disabled && !cancel.disabled, 'Saving must prevent edits and duplicate save without trapping Cancel');
      requireFact(form.querySelector('[role="status"]')?.textContent === 'Saving your name…', 'Save status missing');
    }
    if (evidence.scene === 'failure') {
      requireFact(!input.disabled && !update.disabled, 'Failed save cannot be retried');
      requireFact(document.querySelector('#profile-save-error')?.textContent === evidence.error, 'Save failure explanation missing');
      requireFact(input.value !== evidence.savedName, 'Failed save lost the draft');
    }
    if (evidence.scene === 'discard') {
      requireFact(discard && discard.open && discard.matches(':modal'), 'Discard confirmation must be a native modal');
      const choices = [...discard.querySelectorAll('button')].map(button => button.textContent);
      requireFact(JSON.stringify(choices) === JSON.stringify(['Continue editing', 'Discard']), 'Discard choices changed');
      requireFact(input.value !== evidence.savedName, 'Discard confirmation lost the unsaved draft');
      requireFact(document.activeElement?.id === 'profile-continue', 'Safe discard choice did not receive initial focus');
    } else {
      requireFact(discard === null, 'Unexpected discard confirmation');
    }
    document.documentElement.dataset.profileProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'profile';
  });
})();`;
