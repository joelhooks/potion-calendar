import type { CompactScene } from "./compact-timed-fixture.js";

export interface CompactProof {
  readonly scene: CompactScene;
  readonly theme: "light" | "dark";
  readonly width: number;
  readonly native?: {
    readonly actorPhase: string;
    readonly endTime: string;
    readonly startTime: string;
    readonly edge: string;
    readonly steps: readonly {
      readonly type: string;
      readonly x: number;
      readonly y: number;
    }[];
  };
}

export const compactProofScript = (proof: CompactProof): string => `
const input = ${JSON.stringify(proof)};
const assert = (ok, text) => { if (!ok) throw new Error(text); };
if (input.scene === 'resize') {
  assert(input.native?.actorPhase === 'dragging', 'Native resize must be dragging');
  assert(input.native.endTime === '09:15', 'Native resize must project the live end');
  assert(input.native.startTime === '09:00' && input.native.edge === 'end', 'Native resize must retain start and use the end handle');
  assert(input.native.steps.length === 3, 'Native resize must record three steps');
}
const viewport = document.querySelector('#time-viewport');
assert(viewport, 'Time viewport missing');
viewport.scrollTop = 400;
const chips = [...document.querySelectorAll('.day-column .event-chip')];
assert(chips.length === 2, 'Expected two source chips');
const nodes = [...chips, ...document.querySelectorAll('.gesture-preview')];
assert(nodes.length === (input.scene === 'resize' ? 3 : 2), 'Preview count');
const px = (value) => Number.parseFloat(value);
const records = nodes.map((node) => {
  const style = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  const border = px(style.borderTopWidth) + px(style.borderBottomWidth);
  const stackLine = px(style.getPropertyValue('--timed-stack-line'));
  const stackPadding = px(style.getPropertyValue('--timed-stack-padding'));
  const stackGap = px(style.getPropertyValue('--timed-stack-gap'));
  const budget = stackLine * 2 + stackPadding * 2 + stackGap + border;
  const mode = rect.height < budget ? 'compact' : 'stacked';
  assert(node.dataset.contentMode === mode, 'Mode must follow measured content budget');
  assert(Number(node.dataset.contentBudget) === budget, 'Measured budget must match the descriptor');
  assert(Number.isFinite(budget) && budget > 0, 'Finite measured budget');
  assert(node.scrollWidth <= node.clientWidth + 1, 'Chip content exceeds X');
  assert(node.scrollHeight <= node.clientHeight + 1, 'Chip content exceeds Y');
  const readout = node.querySelector('.timed-readout') ?? node;
  const readoutBox = readout.getBoundingClientRect();
  const children = [...readout.children].filter((child) => child.matches('strong,.event-time'));
  assert(children.length === 2, 'Title and time required');
  if (mode === 'compact') {
    assert(readout !== node, 'Compact readout wrapper required');
    assert(getComputedStyle(readout).overflowX === 'hidden', 'Readout must clip at the chip edge');
    assert(readoutBox.left >= rect.left && readoutBox.right <= rect.right, 'Readout must fit X');
  }
  const contentTop = rect.top + px(style.borderTopWidth) + px(style.paddingTop);
  const contentBottom = rect.bottom - px(style.borderBottomWidth) - px(style.paddingBottom);
  for (const child of children) {
    const box = child.getBoundingClientRect();
    assert(box.top >= contentTop - 1 && box.bottom <= contentBottom + 1, 'Text box exceeds Y');
    assert(child.scrollHeight <= child.clientHeight + 1, 'Text must not truncate vertically');
    if (mode === 'compact') {
      const textStyle = getComputedStyle(child);
      assert(textStyle.whiteSpace === 'nowrap', 'Compact text must not wrap');
      if (child.classList.contains('event-time')) {
        assert(textStyle.flexShrink === '0' && textStyle.textOverflow !== 'ellipsis', 'Time must not shrink or ellipsize');
        assert(child.scrollWidth <= child.clientWidth + 1, 'Time element must retain its full intrinsic width');
        if (readout.clientWidth >= child.scrollWidth) {
          assert(box.left >= readoutBox.left && box.right <= readoutBox.right + 1, 'Time must be fully visible when it fits');
        }
      } else {
        assert(textStyle.overflowX === 'hidden' && textStyle.textOverflow === 'ellipsis', 'Only title ellipsizes');
        if (box.width > 0) assert(box.left >= readoutBox.left && box.right <= readoutBox.right + 1, 'Visible title must fit X');
      }
    } else {
      assert(box.left >= rect.left && box.right <= rect.right, 'Stacked text box exceeds X');
    }
  }
  const time = node.querySelector('.event-time');
  assert(time, 'Time readout required');
  if (mode === 'compact') {
    assert(children[0] === time, 'Compact time must precede title');
    assert(Math.abs(children[0].getBoundingClientRect().top - children[1].getBoundingClientRect().top) <= 1, 'Compact content must share a row');
    if (node.classList.contains('event-chip')) {
      assert(time.textContent === (input.theme === 'dark' ? '09:00' : '9am'), 'Compact source must show formatted start');
      assert(node.getAttribute('aria-label').includes(input.theme === 'dark' ? '09:00 to 09:' : '9am to 9:'), 'Full accessible range must remain');
    } else {
      assert(time.textContent === (input.theme === 'dark' ? '09:00–09:15' : '9am–9:15am'), 'Preview must retain the live full range');
    }
  } else {
    assert(children[0].tagName === 'STRONG' && time.textContent.includes('–'), 'Stacked control must retain full range');
  }
  return { budget, height: rect.height, mode, time: time.textContent, width: rect.width, x: [node.scrollWidth,node.clientWidth], y: [node.scrollHeight,node.clientHeight] };
});
const sourceModes = records.slice(0,2).map((record) => record.mode).sort();
const mixed = input.scene === 'boundary' || input.scene === 'overlap';
assert(JSON.stringify(sourceModes) === JSON.stringify(mixed ? ['compact','stacked'] : ['compact','compact']), 'Scenario modes');
if (input.scene === 'boundary') {
  assert(Math.abs(records[0].height - records[0].budget) <= 1.1, 'Below-switch control must be adjacent');
  assert(Math.abs(records[1].height - records[1].budget) <= 1.1, 'Above-switch control must be adjacent');
}
assert(document.documentElement.scrollWidth <= innerWidth + 1, 'No document overflow');
document.documentElement.dataset.compactProof = JSON.stringify({ ...input, records, result: 'pass' });
document.documentElement.dataset.fixtureReady = 'compact-timed';
`;
