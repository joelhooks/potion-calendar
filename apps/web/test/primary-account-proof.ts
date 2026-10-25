export const primaryAccountProof = String.raw`(() => {
  const requireFact = (ok, message) => { if (!ok) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#primary-account-evidence').textContent);
  const phone = document.querySelector('#phone-settings-dialog');
  if (phone) phone.showModal();
  requestAnimationFrame(() => {
    requireFact(innerWidth === evidence.width && innerHeight === 900, 'Unexpected primary-account fixture viewport');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Primary account widened the viewport');
    requireFact(document.querySelector('.settings-content h1')?.textContent === 'Profile', 'Profile heading missing');
    const form = document.querySelector('.settings-profile-form');
    const select = document.querySelector('#profile-primary-account');
    const name = document.querySelector('#profile-name');
    const update = form.querySelector('button[type="submit"]');
    const cancel = [...form.querySelectorAll('button')].find(button => button.textContent === 'Cancel');
    requireFact(cancel && !cancel.disabled, 'Cancel must stay available');
    requireFact((select === null) === (evidence.scene === 'one'), 'Primary visibility differs from linked accounts');
    if (select) {
      requireFact(document.querySelector('label[for="profile-primary-account"]')?.textContent === 'Primary account to log in', 'Primary label missing');
      requireFact(select.value === evidence.draftPrimaryAccountId, 'Draft primary does not match the Model');
      requireFact(select.options.length === 2, 'Expected two linked Google choices');
      requireFact(select.disabled === (evidence.scene === 'saving'), 'Primary pending barrier differs from lifecycle');
      requireFact(select.getBoundingClientRect().height >= 44, 'Primary choice has a small touch target');
      if (evidence.scene === 'disabled') {
        requireFact(select.selectedOptions[0]?.disabled === true, 'Disconnected selected pointer was lost or enabled');
        requireFact(select.selectedOptions[0]?.textContent.includes('Reconnect required'), 'Disconnected choice lacks an explanation');
      }
    }
    requireFact(update.disabled === (evidence.scene !== 'failure'), 'Update differs from actual dirty state');
    requireFact(name.disabled === (evidence.scene === 'saving'), 'Name and primary do not share the pending barrier');
    if (evidence.scene === 'saving') requireFact(form.querySelector('[role="status"]')?.textContent === 'Saving your profile…', 'Combined save status missing');
    if (evidence.scene === 'failure') requireFact(form.querySelector('[role="alert"]')?.textContent === evidence.error, 'Failed save explanation missing');
    if (evidence.width === 390) requireFact(phone && phone.open && phone.matches(':modal'), 'Phone settings must be a native modal');
    else requireFact(phone === null, 'Desktop unexpectedly uses a phone sheet');
    document.documentElement.dataset.primaryAccountProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'primary-account';
  });
})();`;
