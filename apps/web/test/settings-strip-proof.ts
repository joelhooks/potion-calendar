import { attachSettingsStrip } from "../src/client/settings/strip.js";

export const settingsStripProof = String.raw`(() => {
  const requireFact = (ok, message) => { if (!ok) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#settings-strip-evidence').textContent);
  const phone = document.querySelector('#phone-settings-dialog');
  requireFact(phone, 'Phone settings sheet missing');
  phone.showModal();
  const focused = document.activeElement;
  const release = (${attachSettingsStrip.toString()})(document.body);
  requestAnimationFrame(() => {
    requireFact(innerWidth === evidence.width && innerHeight === 900, 'Unexpected settings strip viewport');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Settings widened the viewport');
    requireFact(phone.open && phone.matches(':modal'), 'Settings sheet is not a native modal');
    const strip = phone.querySelector('.settings-nav');
    const active = strip.querySelector('a[aria-current="page"]');
    requireFact(active?.getAttribute('href') === evidence.route, 'Active tab differs from route');
    const box = strip.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    const left = box.left + strip.clientLeft;
    const top = box.top + strip.clientTop;
    const right = left + strip.clientWidth;
    const bottom = top + strip.clientHeight;
    requireFact(strip.scrollWidth > strip.clientWidth, 'Fixture does not exercise an overflowing strip');
    requireFact(strip.scrollLeft > 0, 'Off-screen tab did not scroll into view');
    requireFact(tab.left >= left - 0.5 && tab.right <= right + 0.5 && tab.top >= top - 0.5 && tab.bottom <= bottom + 0.5, 'Active tab is not fully inside the strip visible box');
    requireFact(document.activeElement === focused, 'Strip moved focus');
    document.querySelector('#settings-strip-geometry').textContent = JSON.stringify({
      page: evidence.page, theme: evidence.theme, width: innerWidth,
      strip: {left, right, top, bottom, clientWidth: strip.clientWidth, scrollWidth: strip.scrollWidth, scrollLeft: strip.scrollLeft},
      tab: {left: tab.left, right: tab.right, top: tab.top, bottom: tab.bottom},
      focusUnchanged: document.activeElement === focused
    });
    document.documentElement.dataset.activeTabVisible = 'pass';
    document.documentElement.dataset.settingsStripProof = 'pass';
    document.documentElement.dataset.fixtureReady = 'settings-strip';
    release();
  });
})();`;
