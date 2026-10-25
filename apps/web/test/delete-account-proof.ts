import { attachSettingsStrip } from "../src/client/settings/strip.js";

export const deleteAccountProof = String.raw`(() => {
  const requireFact = (ok, message) => { if (!ok) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#delete-account-evidence').textContent);
  const phone = document.querySelector('#phone-settings-dialog');
  const dialog = document.querySelector('#delete-account-dialog');
  if (phone) phone.showModal();
  const releaseStrip = (${attachSettingsStrip.toString()})(document.body);
  if (dialog) {
    dialog.showModal();
    if (evidence.mode !== 'deleting') document.querySelector('#delete-account-cancel').focus();
  } else {
    document.querySelector('.settings-delete-account').scrollIntoView({block:'end', inline:'nearest', behavior:'instant'});
  }
  requestAnimationFrame(() => {
    requireFact(innerWidth === evidence.width && innerHeight === 900, 'Unexpected deletion fixture viewport');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Deletion widened the viewport');
    requireFact(document.querySelector('.settings-content h1')?.textContent === 'Profile', 'Profile heading missing');
    requireFact(document.querySelector('.settings-nav a[aria-current="page"]')?.getAttribute('href') === '/settings/profile', 'Profile route changed');
    const open = document.querySelector('#delete-account-open');
    requireFact(open && open.closest('form') === null, 'Deletion is inside the name form');
    requireFact(open.textContent === 'Delete account…', 'Deletion entry label changed');
    requireFact(Boolean(dialog) === (evidence.scene !== 'section'), 'Dialog presence differs from the real Model');
    if (evidence.width === 390) requireFact(phone && phone.open && phone.matches(':modal'), 'Phone Profile is not a native sheet');
    else requireFact(phone === null, 'Desktop unexpectedly uses a phone sheet');
    const geometry = {scene:evidence.scene, width:innerWidth, theme:evidence.theme, focus:document.activeElement?.id, dialog:null};
    if (dialog) {
      requireFact(dialog.open && dialog.matches(':modal'), 'Deletion is not a native modal');
      requireFact(dialog.getAttribute('aria-label') === 'Delete your Potion Calendar account?', 'Dialog accessible name changed');
      requireFact(dialog.getAttribute('aria-describedby') === 'delete-account-retention', 'Retention description is not connected');
      requireFact(dialog.textContent.includes('Calendars and contacts stored with Google are not deleted.'), 'Google retention copy missing');
      requireFact(dialog.textContent.includes("Potion Calendar will still appear in your Google account's third-party access list until you remove it there."), 'Third-party access copy missing');
      const cancel = document.querySelector('#delete-account-cancel');
      const confirm = document.querySelector('#delete-account-confirm');
      const busy = evidence.mode === 'deleting';
      requireFact(cancel.disabled === busy && confirm.disabled === busy, 'Pending control enablement differs from lifecycle');
      requireFact(confirm.textContent === (busy ? 'Deleting…' : 'Permanently delete account'), 'Confirmation label differs from lifecycle');
      if (!busy) requireFact(document.activeElement === cancel, 'Cancel did not receive safe initial focus');
      requireFact(Boolean(document.querySelector('#delete-account-error')) === (evidence.scene === 'failure'), 'Failure presentation differs from lifecycle');
      const box = dialog.getBoundingClientRect();
      requireFact(box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, 'Dialog escapes the viewport');
      requireFact(dialog.scrollWidth <= dialog.clientWidth, 'Dialog has horizontal overflow');
      geometry.dialog = {left:box.left, top:box.top, right:box.right, bottom:box.bottom, scrollHeight:dialog.scrollHeight, clientHeight:dialog.clientHeight};
      geometry.controls = [cancel,confirm].map(button => {const rect=button.getBoundingClientRect();requireFact(rect.height >= 44,'Deletion choice is below 44px');return {label:button.textContent,disabled:button.disabled,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};});
    } else {
      requireFact(!open.disabled, 'Confirmed-session deletion entry is disabled');
      const box = open.getBoundingClientRect();
      requireFact(box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth, 'Deletion entry is outside the viewport');
    }
    document.querySelector('#delete-account-geometry').textContent = JSON.stringify(geometry);
    document.documentElement.dataset.accountDeletionProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'delete-account';
    releaseStrip();
  });
})();`;
