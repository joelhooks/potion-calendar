export const phoneShellProofScript = String.raw`
(() => {
  const requireFact = (ok, message) => { if (!ok) throw Error(message); };
  const evidence = JSON.parse(document.querySelector('#phone-shell-evidence').textContent);
  const dialog = document.querySelector('[data-phone-shell-dialog]');
  if (dialog) dialog.showModal();
  requestAnimationFrame(() => {
    const grid = document.querySelector('.calendar-view, .month-view');
    const toolbar = document.querySelector('.phone-toolbar');
    const heading = toolbar.querySelector('h2');
    const navigation = toolbar.querySelector('.phone-navigation');
    const commands = document.querySelector('#command-menu-button');
    requireFact(innerWidth === evidence.width, 'CSS viewport differs from fixture model');
    requireFact(evidence.gridWidth === evidence.width && evidence.gridWidth > 0, 'Grid model width is not the full phone viewport');
    requireFact(document.documentElement.scrollWidth <= innerWidth, 'Page has horizontal overflow');
    requireFact(grid.getBoundingClientRect().width >= innerWidth - 2, 'Phone sheet leaves the grid narrowed');
    requireFact(heading.getBoundingClientRect().bottom <= navigation.getBoundingClientRect().top + 1, 'Date title is not on its own row');
    requireFact(commands.getBoundingClientRect().bottom <= grid.getBoundingClientRect().top + 1, 'Commands covers the grid');
    requireFact(document.querySelectorAll('.workspace > .detail-panel, .workspace > .upcoming-panel, .workspace > .sidebar-shell').length === 0, 'Phone renders a grid-narrowing column');
    for (const control of document.querySelectorAll('.phone-toolbar button, .phone-toolbar select, .phone-shell-dialog button')) {
      const box = control.getBoundingClientRect();
      requireFact(box.width >= 43.9 && box.height >= 43.9, 'Phone control is below the 44px tap target: ' + (control.getAttribute('aria-label') || control.textContent));
    }
    if (evidence.mode === 'closed') requireFact(!dialog, 'Closed shell has a dialog');
    else {
      requireFact(dialog && dialog.open && dialog.matches(':modal'), 'Phone panel is not modal');
      const panelHeader = dialog.querySelector(':scope > header');
      const panelContent = dialog.querySelector(':scope > .phone-panel-content');
      requireFact(panelHeader && panelContent, 'Phone panel needs a separate title and close header');
      const headerBox = panelHeader.getBoundingClientRect();
      const contentBox = panelContent.getBoundingClientRect();
      const titleBox = panelHeader.querySelector('h2').getBoundingClientRect();
      const closeBox = panelHeader.querySelector('button').getBoundingClientRect();
      requireFact(contentBox.top >= headerBox.bottom - 1, 'Phone panel content overlaps its header');
      requireFact(titleBox.right + 8 <= closeBox.left, 'Phone panel title and close overlap');
      requireFact(closeBox.top >= headerBox.top - 1 && closeBox.bottom <= headerBox.bottom + 1, 'Close button is outside the panel header');
      const expectedTitle = evidence.mode === 'drawer' ? 'Calendars' : evidence.mode === 'details' ? 'Product review' : 'Upcoming meeting';
      requireFact(panelHeader.querySelector('h2').textContent === expectedTitle, 'Incorrect phone panel heading');
      if (evidence.mode === 'drawer') {
        const weekdays = [...dialog.querySelectorAll('.mini-days .weekday')];
        requireFact(weekdays.length === 7 && weekdays.every(day => day.getBoundingClientRect().top >= headerBox.bottom + 8), 'Drawer close overlaps the mini-calendar weekday row');
      }
      if (evidence.mode === 'details') requireFact(dialog.querySelectorAll('.detail-panel > h2, .close-detail').length === 0, 'Details heading was duplicated instead of moved');
      const box = dialog.getBoundingClientRect();
      requireFact(box.left >= -1 && box.right <= innerWidth + 1, 'Phone panel exceeds viewport');
      if (evidence.mode !== 'drawer') requireFact(Math.abs(box.bottom - innerHeight) <= 2, 'Phone sheet is not bottom aligned');
      if (evidence.mode === 'upcoming') requireFact(dialog.textContent.includes('Product review'), 'Upcoming sheet has no meeting');
    }
    document.documentElement.dataset.phoneShellProof = 'pass';
  });
})();
`;
