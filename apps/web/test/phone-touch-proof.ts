import { placeTouchCorners } from "../src/client/editing/touch-surfaces.js";
import type { PhoneTouchScene } from "./phone-touch-fixture.js";

export const phoneTouchProofScript = (scene: PhoneTouchScene) => `(() => {
  const scene = ${JSON.stringify(scene)};
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  require(window.__JSDOM_STAND_IN__ !== true, 'This proof requires real browser geometry');
  require(innerWidth === scene.width && innerHeight === scene.height, 'Exact declared phone viewport');
  require(matchMedia('(any-pointer: coarse)').matches, 'Coarse touch review');
  const root = document.querySelector('#gesture-host');
  const viewport = document.querySelector('#time-viewport');
  const column = document.querySelector('.day-column');
  const anchor = column?.querySelector(scene.kind === 'move' ? '.event-chip.selected' : '.event-chip');
  require(root && viewport && column && anchor, 'Actual app calendar root');
  require(document.querySelectorAll('.day-column').length === 1, 'Measured phone Day model');
  viewport.scrollTop = Math.max(0, anchor.offsetTop - 100);
  (${placeTouchCorners.toString()})(root);
  const anchorBox = anchor.getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  require(anchorBox.width > 0 && anchorBox.height > 0, 'Nonzero event geometry');
  require(anchorBox.top >= frame.top - 1 && anchorBox.bottom <= frame.bottom + 1, 'Fixture event is visible');
  if (scene.state === 'pressed') {
    require(document.querySelector('.gesture-preview') === null, 'No preview before hold');
    root.dataset.touchEditPhase = 'pressed';
    root.style.setProperty('--touch-press-x', (scene.kind === 'move' ? anchorBox.left + anchorBox.width / 2 : column.getBoundingClientRect().right - 30) + 'px');
    root.style.setProperty('--touch-press-y', (scene.kind === 'move' ? anchorBox.top + anchorBox.height / 2 : anchorBox.bottom + 30) + 'px');
    const cue = getComputedStyle(root, '::after');
    require(cue.position === 'fixed' && parseFloat(cue.width) === 44, 'Pressed contact cue uses runtime state selector');
    const swatch = document.createElement('span');
    swatch.style.color = 'var(--focus)';
    root.append(swatch);
    const focus = getComputedStyle(swatch).color;
    swatch.remove();
    require(cue.outlineColor === focus, 'Pressed cue uses the existing focus palette');
    const luminance = color => {
      const rgb = color.match(/[0-9.]+/g)?.slice(0, 3).map(Number);
      require(rgb?.length === 3, 'Resolved cue and grid colors');
      const channels = rgb.map(value => { const unit = value / 255; return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const stroke = luminance(cue.borderTopColor);
    const grid = luminance(getComputedStyle(document.querySelector('.app')).backgroundColor);
    const contrast = (Math.max(stroke, grid) + 0.05) / (Math.min(stroke, grid) + 0.05);
    require(contrast >= 3, 'Pressed cue reaches 3:1 contrast against the grid');
    root.dataset.touchCueContrast = String(contrast);
  } else if (scene.state === 'preview') {
    const preview = document.querySelector('.gesture-preview');
    require(preview !== null, 'Existing gesture preview');
    const box = preview.getBoundingClientRect();
    require(box.width > 0 && box.height > 0 && box.left >= frame.left - 1 && box.right <= frame.right + 1, 'Preview fits the grid');
  } else if (scene.kind === 'move') {
    require(document.querySelector('.gesture-refusal[role=alert]')?.textContent.includes('Nothing was changed.'), 'Existing read-only refusal recipient');
    require(document.querySelector('.gesture-preview') === null, 'Refused movement has no preview');
  } else {
    require(document.body.textContent.includes('No writable calendar is available.'), 'Existing creation refusal recipient');
    require(document.querySelector('.gesture-preview') === null, 'Refused creation has no preview');
  }
  for (const handle of document.querySelectorAll('.event-chip.selected .touch-resize-target')) {
    const box = handle.getBoundingClientRect();
    require(box.width >= 44 && box.height >= 44, 'Coarse corner region is at least44px');
    const day = column.getBoundingClientRect();
    require(box.left >= Math.max(day.left, frame.left) - 1 && box.right <= Math.min(day.right, frame.right) + 1, 'Corner fits the visible day width');
    require(box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1, 'Corner fits the visible scroll height');
    require(getComputedStyle(handle).pointerEvents === 'none', 'Corner hit ownership stays with the gesture resolver');
  }
  require(document.querySelector('[data-editing-dialog]') === null, 'Snapshots do not pretend a provider editor was opened');
  require(document.documentElement.scrollWidth <= innerWidth + 1, 'No horizontal page overflow');
  document.documentElement.dataset.phoneTouchProof = 'browser geometry; frozen state, not a timed input run';
  document.documentElement.dataset.fixtureReady = 'phone-touch';
})();`;
