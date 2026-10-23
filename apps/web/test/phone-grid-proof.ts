export const phoneGridProofScript = (expected: {
  readonly scene: string;
  readonly width: number;
  readonly height: number;
  readonly zones: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
  readonly monthPosition:
    | { readonly scrollTop: number; readonly firstVisibleDay: number }
    | undefined;
}) => `(() => {
  const expected = ${JSON.stringify(expected)};
  const standIn = window.__JSDOM_STAND_IN__ === true;
  const require = (condition, label) => { if (!condition) throw new Error(label); };
  require(document.querySelector('.phone-toolbar') !== null, 'phone toolbar');
  require(document.querySelector('.sidebar:not(dialog .sidebar)') === null, 'no sidebar column');
  const dialog = document.querySelector('[data-phone-shell-dialog]');
  if (expected.scene === 'selected') {
    require(dialog?.dataset.phoneShellDialog === 'details', 'selected chip uses the M1 sheet');
    require(document.querySelectorAll('.event-chip.selected').length > 0, 'selected chip');
    if (!standIn && !dialog.open) dialog.showModal();
  } else {
    require(dialog === null, 'no unexpected sheet');
  }
  if (expected.scene === 'month') {
    require(document.querySelector('.month-view') !== null, 'month view');
    require(document.querySelectorAll('.month-view .event-chip,.month-span').length === 0, 'compact month has no overflowing chips');
    require(document.querySelectorAll('[data-phone-month-count]').length === Object.keys(expected.counts).length, 'all compact day cells');
    require(expected.monthPosition !== undefined, 'declared anchored month position');
    const viewport = document.querySelector('#month-viewport');
    viewport.dataset.fixtureMonthScrollTop = String(expected.monthPosition.scrollTop);
    viewport.scrollTop = expected.monthPosition.scrollTop;
    if (!standIn) {
      require(Math.abs(viewport.scrollTop - expected.monthPosition.scrollTop) <= 1, 'static fixture uses the production initial month position');
      const row = document.querySelector('[data-week-start="' + expected.monthPosition.firstVisibleDay + '"]');
      const frame = viewport.getBoundingClientRect();
      require(row !== null && Math.abs(row.getBoundingClientRect().top - frame.top) <= 1.5, 'anchored first week is visible');
      const visibleCounts = [...viewport.querySelectorAll('.phone-month-summary')].filter(button => {
        const rect = button.getBoundingClientRect();
        return rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1;
      });
      require(visibleCounts.length > 0, 'anchored month shows its event counts');
    }
    for (const cell of document.querySelectorAll('[data-phone-month-count]')) {
      require(Number(cell.dataset.phoneMonthCount) === (expected.counts[cell.dataset.day] ?? 0), 'correct day count');
      require(cell.querySelector('.month-date[aria-label]') !== null, 'accessible date');
      if (!standIn) {
        const box = cell.getBoundingClientRect();
        for (const button of cell.querySelectorAll('button')) {
          const rect = button.getBoundingClientRect();
          require(rect.width >= 44 && rect.height >= 44, 'month tap target');
          require(rect.left >= box.left - 1 && rect.right <= box.right + 1, 'month control fits its cell');
        }
      }
    }
  } else {
    const zones = [...document.querySelectorAll('.zone-header')].map(node => node.dataset.zoneId);
    require(JSON.stringify(zones) === JSON.stringify(expected.zones), 'primary and optional travel only');
    require(document.querySelectorAll('[data-zone-drag-id]').length === 0, 'saved secondaries are not drag handles');
    require(document.querySelectorAll('.day-column').length === 1, 'Day view');
    require(document.querySelector('.day-header[aria-label]') !== null, 'full accessible day');
    if (!standIn) {
      const viewport = document.querySelector('#time-viewport').getBoundingClientRect();
      const grid = document.querySelector('.day-headers').getBoundingClientRect();
      require(grid.width <= viewport.width + 1, 'zones and day fit the viewport');
    }
  }
  if (!standIn) {
    require(innerWidth === expected.width && innerHeight === expected.height, 'requested viewport');
    require(document.documentElement.scrollWidth <= innerWidth + 1, 'no horizontal page overflow');
    if (dialog !== null) {
      const rect = dialog.getBoundingClientRect();
      require(rect.left >= -1 && rect.right <= innerWidth + 1, 'sheet stays on screen');
    }
  }
  document.documentElement.dataset.phoneGridProof = standIn ? 'JSDOM stand-in; not browser proof' : 'browser';
  document.documentElement.dataset.fixtureReady = 'phone-grid';
})();`;
