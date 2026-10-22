export const timeZonesProofScript = (minimum: number): string => `(() => {
const check = (value, message) => { if (!value) throw Error(message); };
const frame = document.querySelector('#time-viewport');
const panel = document.querySelector('.detail-panel,.upcoming-panel');
check(document.documentElement.scrollWidth === innerWidth, 'Page widened');
check(frame, 'Missing grid viewport');
check(!document.querySelector('.app').textContent.includes('Loading'), 'Unsettled calendar fixture');
check(Math.abs(frame.getBoundingClientRect().right - (panel?.getBoundingClientRect().left ?? innerWidth)) <= 1, 'Grid leaves blank strip');
for (const day of document.querySelectorAll('.day-column')) check(day.getBoundingClientRect().width >= ${minimum} - 0.5, 'Crushed day column');
const oldLeft = frame.scrollLeft;
frame.scrollLeft = Math.min(120, frame.scrollWidth - frame.clientWidth);
const left = frame.getBoundingClientRect().left;
for (const selector of ['.zone-header','.time-labels']) [...document.querySelectorAll(selector)].forEach((node,index) => {
  check(Math.abs(node.getBoundingClientRect().left - left - index * 46) <= 1, 'Zone gutter moved');
});
check(Math.abs(document.querySelector('.all-day-gutter').getBoundingClientRect().left - left) <= 1, 'All-day gutter moved');
frame.scrollTop = 80;
check(Math.abs(document.querySelector('.day-headers').getBoundingClientRect().top - frame.getBoundingClientRect().top) <= 1, 'Day header moved');
frame.scrollTop = 0;
frame.scrollLeft = oldLeft;
document.documentElement.dataset.zoneLayoutGeometry = document.documentElement.dataset.scriptGeometry || 'browser';
document.documentElement.dataset.zoneLayoutProof = 'pass';
})();`;
