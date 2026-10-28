import { runInNewContext } from "node:vm";

export const accountCustomProof = `(() => {
const evidence = JSON.parse(document.getElementById('account-custom-evidence').textContent);
const require = (condition, message) => { if (!condition) throw new Error(message); };
require(evidence.legacyEntries.length === 1 && evidence.legacyEntries[0].id === 'account-room', 'legacy import source preserved');
if (evidence.width === 390) require(document.querySelector(evidence.scene === 'draft' ? 'dialog[data-editing-dialog]' : 'dialog[data-phone-route-dialog]') !== null, 'actual phone dialog recipient');
if (evidence.scene === 'draft') {
  require(document.body.textContent.includes(evidence.entry.link), 'pending custom URL visible');
  require(document.body.textContent.includes('appended to the description when you save'), 'custom proposal is not a provider conference');
  require(document.getElementById('event-remove-conferencing') !== null, 'custom proposal can be explicitly suppressed');
} else if (evidence.scene === 'failed') {
  const select = document.getElementById('user-default-conferencing');
  require(select !== null, 'actual user default control');
  require(JSON.stringify([...select.options].map(option => option.value)) === JSON.stringify(['none','googleMeet']), 'user-wide choices remain None and Google Meet');
  require(document.body.textContent.includes('may have been saved'), 'lost acknowledgement is not rollback evidence');
  require(document.getElementById('custom-video-link').value === evidence.entry.link, 'unconfirmed draft retained');
  require([...document.querySelectorAll('button')].some(button => button.textContent === 'Reload custom links'), 'explicit reconciliation action');
} else {
  const select = document.getElementById('conferencing-default-work');
  require(select !== null, 'actual account default recipient');
  if (evidence.scene === 'removed') {
    require(select.value === 'none', 'removed custom default is explicit none, not inheritance or Meet');
    require(![...select.options].some(option => option.value.startsWith('custom:')), 'removed custom link unavailable as a choice');
  } else {
    require(select.value === 'custom:account-room', 'stable custom reference remains selected');
    if (evidence.scene === 'missing') require(select.selectedOptions[0].textContent.includes('unavailable'), 'missing reference never silently falls back');
    else require(select.selectedOptions[0].textContent === evidence.entry.name, 'edited name follows stable ID');
  }
}
document.documentElement.dataset.accountCustomProof = 'pass';
})();`;

export const executeAccountCustomProof = (html: string) => {
  const document = new DOMParser().parseFromString(html, "text/html");

  const script = document.querySelector(
    "script[data-account-custom-proof]"
  )?.textContent;

  if (script === null || script === undefined || script === "") {
    throw new Error("Missing emitted custom conferencing proof");
  }

  runInNewContext(script, { Error, JSON, document });

  return document;
};
