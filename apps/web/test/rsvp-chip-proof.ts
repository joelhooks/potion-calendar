export const rsvpChipProofScript = (expected: {
  readonly width: number;
  readonly height: number;
  readonly mode: string;
  readonly monthScrollTop: number | undefined;
}) => `(() => {
  const expected = ${JSON.stringify(expected)};
  const standIn = window.__JSDOM_STAND_IN__ === true;
  const require = (condition, label) => { if (!condition) throw new Error(label); };
  const chips = [...document.querySelectorAll('.event-chip')];
  require(chips.length > 0, 'real chips');
  const statuses = ['accepted', 'declined', 'unanswered', 'tentative', 'unconfirmed'];
  for (const status of statuses) require(chips.some(chip => chip.classList.contains('status-' + status)), status + ' control');
  require(chips.some(chip => chip.classList.contains('selected')), 'selected controls');
  const viewport = document.querySelector(expected.mode === 'month' ? '#month-viewport' : '#time-viewport');
  require(viewport !== null, 'grid viewport');
  viewport.scrollTop = expected.monthScrollTop ?? 384;
  if (!standIn) {
    require(innerWidth === expected.width && innerHeight === expected.height, 'requested viewport');
    require(document.documentElement.scrollWidth <= innerWidth + 1, 'no horizontal page overflow');
    const rgb = value => {
      const numbers = value.match(/[\\d.]+/g)?.map(Number) ?? [];
      require(numbers.length >= 3, 'computed RGB colour: ' + value);
      return numbers;
    };
    const luminance = value => rgb(value).slice(0, 3).reduce((sum, channel, index) => {
      const s = channel / 255;
      return sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
    }, 0);
    const contrast = (a, b) => {
      const x = luminance(a), y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const normalize = value => {
      const node = document.createElement('span');
      node.style.color = value;
      document.body.append(node);
      const result = getComputedStyle(node).color;
      node.remove();
      return result;
    };
    const page = normalize(getComputedStyle(document.querySelector('.app')).getPropertyValue('--surface'));
    const results = [];
    for (const chip of chips) {
      const style = getComputedStyle(chip);
      const selected = chip.classList.contains('selected');
      const status = statuses.find(name => chip.classList.contains('status-' + name));
      const dashed = ['declined', 'unanswered', 'unconfirmed'].includes(status);
      const timedMonth = chip.closest('.month-item-timed') !== null;
      if (dashed) require(style.borderTopStyle === 'dashed', status + ' retains dash');
      if (selected && dashed) require(contrast(style.borderTopColor, style.backgroundColor) >= 3, status + ' selected dash has non-text contrast');
      if (selected) {
        require(style.color === 'rgb(255, 255, 255)', 'selected white text');
        require(contrast(style.color, style.backgroundColor) >= 4.5, 'selected AA text');
      } else if (dashed) {
        const tone = normalize(style.getPropertyValue('--event-status-text'));
        require(style.color === tone, status + ' family text');
        require(style.borderTopColor === tone, status + ' family outline');
        require(contrast(style.color, page) >= 4.5, status + ' AA page text');
        if (!timedMonth) require(style.backgroundColor === page, status + ' page fill');
      }
      if (timedMonth && !selected) {
        const channels = rgb(style.backgroundColor);
        require(channels.length === 4 && channels[3] === 0, 'transparent Month timed item');
        const marker = chip.querySelector('.calendar-ribbon');
        require(marker !== null && rgb(getComputedStyle(marker).backgroundColor).length >= 3, 'coloured compact Month marker');
      }
      const strike = node => (getComputedStyle(node).textDecorationLine || getComputedStyle(node).textDecoration).includes('line-through');
      if (status === 'declined') {
        require(strike(chip.querySelector('strong')), 'declined title struck');
        const time = chip.querySelector('.event-time');
        if (time !== null) require(strike(time), 'declined time struck');
      }
      if (status === 'unanswered') require(!strike(chip.querySelector('strong')), 'unanswered title not struck');
      if (status === 'tentative' && !timedMonth && !selected) require(style.backgroundColor === normalize(style.getPropertyValue('--event-fill')), 'tentative retains ordinary fill');
      results.push({ key: chip.dataset.eventKey, status, selected, fill: style.backgroundColor, color: style.color, border: style.borderTopColor, dashContrast: selected && dashed ? contrast(style.borderTopColor, style.backgroundColor) : null, dashed: style.borderTopStyle === 'dashed' });
    }
    document.documentElement.dataset.rsvpCheckedChips = String(results.length);
    window.__rsvpComputedEvidence = results;
  }
  document.documentElement.dataset.rsvpProof = standIn ? 'JSDOM stand-in; not browser proof' : 'browser';
  document.documentElement.dataset.fixtureReady = 'rsvp-chips';
})();`;
