import type { Effect } from "effect";

import type { nativeEdgeScene } from "./edge-scroll-native.js";

type NativeScene = Effect.Success<ReturnType<typeof nativeEdgeScene>>;

export type EdgeProof = NativeScene["proof"];

export const edgeProofScript = (evidence: EdgeProof): string => `(() => {
const e = ${JSON.stringify(evidence).replaceAll("<", "\\u003c")};
const fail = message => { throw new Error('edge-scroll proof: ' + message); };
const check = (value, message) => { if (!value) fail(message); };
const viewport = document.querySelector('#time-viewport');
check(viewport && e.actorPhase === 'dragging', 'loaded active native snapshot');
check(e.steps.length === 4 && e.steps.map(step => step.type).join(',') === 'pointerdown,pointermove,pointermove,pointermove', 'four deterministic native pointer steps');
check(e.dayCount === (e.scene === 'wide-no-overflow' ? 1 : 14), 'configured day count');
check(e.zones === (e.scene === 'wide-no-overflow' ? 1 : 4), 'configured fixed zone columns');
check(document.querySelectorAll('.day-column[data-day]').length === e.dayCount, 'actual date columns');
check(document.querySelectorAll('.zone-header').length === e.zones, 'actual zones');
check(!document.querySelector('.editor-dialog'), 'mid-drag rather than committed editor');
check(document.querySelector('.event-chip.selected'), 'loaded selected source event');
check(!document.querySelector('.calendar-view').textContent.includes('Loading'), 'settled calendar');
const selector = e.allDay ? '.all-day-cell[data-day]' : '.day-column[data-day]';
const columns = [...viewport.querySelectorAll(selector)];
const goal = columns.find(column => Number(column.dataset.day) === e.columnDay);
check(goal && e.previewDate === e.columnDate, 'native column and preview date agree');
check((e.allDay ? e.previewRange.endDate : e.previewRange.startDate) === e.columnDate, 'recorded range uses the native hit date');
viewport.scrollTop = e.topBefore;
viewport.scrollLeft = e.before;
const before = viewport.scrollLeft;
const frame = viewport.getBoundingClientRect();
const initial = goal.getBoundingClientRect();
const clipped = initial.left >= frame.right;
const overflow = viewport.scrollWidth > viewport.clientWidth;
check(e.scene === 'wide-no-overflow' ? !overflow && !e.clipped : overflow && clipped && e.clipped, 'real initial clipping/overflow');
check(before === e.before, 'native initial horizontal offset');
const edgeStep = e.steps[2].x - (e.frameLeft + e.viewportWidth);
check(edgeStep > 0, 'recorded right-edge displacement');
const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
viewport.scrollLeft = Math.max(0, Math.min(maximum, before + edgeStep));
const after = viewport.scrollLeft;
check(after >= 0 && after <= maximum, 'browser bounded offset');
check(e.scene === 'wide-no-overflow' ? after === before : after > before, 'edge movement or no-overflow no-op');
const box = goal.getBoundingClientRect();
const x = Math.min(frame.right, box.right) - 4;
const under = columns.find(column => { const b = column.getBoundingClientRect(); return x >= b.left && x < b.right; });
check(under === goal, 'actual column under the frozen pointer');
const preview = goal.querySelector('.gesture-preview');
check(preview && preview.textContent.includes('Edge scroll'), 'actual preview on formerly clipped date');
const p = preview.getBoundingClientRect();
check(p.width > 0 && p.height > 0 && p.left >= frame.left + e.zones * 46 - 1 && p.left < frame.right && p.top >= frame.top && p.bottom <= frame.bottom + 1, 'visible preview inside its own viewport');
const segments = [...viewport.querySelectorAll('.gesture-preview')];
check(segments.length > 0, 'preview segments are present');
for (const segment of segments) {
  check(segment.scrollWidth <= segment.clientWidth, 'preview content stays horizontally inside every chip');
  check(segment.scrollHeight <= segment.clientHeight, 'preview content stays vertically inside every chip');
}
let titleProof;
if (e.scene === 'narrow-preview') {
  check(window.innerWidth === 900 && e.dayCount === 14 && !e.allDay && preview.classList.contains('timed-content-stacked'), 'narrow fourteen-day stacked timed preview');
  const title = preview.querySelector(':scope > strong');
  check(title, 'actual preview title');
  const style = getComputedStyle(title);
  check(style.whiteSpace === 'nowrap' && style.textOverflow === 'ellipsis', 'single-line ellipsis title');
  check(title.clientWidth > 0 && title.scrollWidth > title.clientWidth, 'title exceeds its narrow available width');
  const height = title.getBoundingClientRect().height;
  const lineHeight = Number.parseFloat(style.lineHeight);
  check(height > 0 && height <= lineHeight + 1, 'title occupies one actual line');
  titleProof = { whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, width: title.clientWidth, scrollWidth: title.scrollWidth, height, lineHeight };
}
const gutterProof = (element, region) => {
  const b = element.getBoundingClientRect();
  const y = region === 'body' ? Math.min(frame.bottom - 4, frame.top + 200) : b.top + b.height / 2;
  const x = b.left + b.width / 2;
  const hit = document.elementFromPoint(x, y);
  check(b.width > 0 && b.height > 0 && hit && element.contains(hit), 'opaque ' + region + ' gutter owns its hit point');
  const background = getComputedStyle(element).backgroundColor;
  check(background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)', 'opaque ' + region + ' gutter background');
};
for (const gutter of viewport.querySelectorAll('.zone-header')) gutterProof(gutter, 'header');
for (const gutter of viewport.querySelectorAll('.time-labels')) gutterProof(gutter, 'body');
gutterProof(viewport.querySelector('.all-day-gutter'), 'all-day');
check(getComputedStyle(viewport.querySelector('.day-columns')).isolation === 'isolate', 'now indicators remain below sticky gutters');
check(getComputedStyle(viewport.querySelector('.day-columns')).overflowX === 'clip', 'now indicators stay in the date area');
check(viewport.scrollTop === e.topBefore && e.topAfter === e.topBefore, 'horizontal-only fixture does not scroll hours');
check(document.documentElement.scrollWidth <= window.innerWidth + 1, 'no document overflow');
document.documentElement.dataset.edgeProof = JSON.stringify({
  status: 'pass', geometry: document.documentElement.dataset.scriptGeometry || 'browser',
  scene: e.scene, dayCount: e.dayCount, zones: e.zones,
  before, after, maximum, nativeStandInAfter: e.after, initialClipped: clipped, underPointer: Number(under.dataset.day),
  columnDate: e.columnDate, previewDate: e.previewDate,
  clientWidth: viewport.clientWidth, scrollWidth: viewport.scrollWidth,
  frozen: true, steps: e.steps.length, previewSegments: segments.length, title: titleProof
});
document.documentElement.dataset.fixtureReady = 'edge-scroll';
})();`;

export const edgeStandInStyle = (element: Element) => {
  const document = element.ownerDocument;
  const style = getComputedStyle(element);
  const app = element.closest(".app") ?? document.documentElement;

  const surface =
    getComputedStyle(app).getPropertyValue("--surface") ||
    getComputedStyle(document.documentElement).getPropertyValue("--surface");

  const color = document.createElement("span");
  color.style.backgroundColor = surface;

  return {
    backgroundColor:
      element instanceof HTMLElement &&
      element.style.background === "var(--surface)"
        ? color.style.backgroundColor
        : style.backgroundColor,
    isolation: style.isolation,
    lineHeight: "12px",
    overflowX: style.overflowX || style.overflow,
    textOverflow: style.textOverflow,
    whiteSpace: style.whiteSpace,
  };
};

export const edgeProofStandIns = (document: Document, e: EdgeProof): void => {
  document.documentElement.dataset.scriptGeometry =
    "JSDOM stand-in boxes, not browser layout";
  const viewport = document.querySelector<HTMLElement>("#time-viewport");

  if (viewport === null) {
    throw new Error("Missing edge-scroll viewport");
  }

  viewport.getBoundingClientRect = () =>
    new DOMRect(e.frameLeft, 56, e.viewportWidth, 904);
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: e.viewportWidth },
    scrollWidth: { configurable: true, value: e.contentWidth },
  });

  const columns = [
    ...viewport.querySelectorAll<HTMLElement>(
      e.allDay ? ".all-day-cell[data-day]" : ".day-column[data-day]"
    ),
  ];

  const first = Number(columns[0]?.dataset.day);

  const headers = [...viewport.querySelectorAll<HTMLElement>(".zone-header")];
  const labels = [...viewport.querySelectorAll<HTMLElement>(".time-labels")];
  const allDayGutter = viewport.querySelector<HTMLElement>(".all-day-gutter");

  for (const [index, element] of headers.entries()) {
    element.getBoundingClientRect = () =>
      new DOMRect(e.frameLeft + index * 46, 56, 46, 28);
  }

  for (const [index, element] of labels.entries()) {
    element.getBoundingClientRect = () =>
      new DOMRect(
        e.frameLeft + index * 46,
        109 - viewport.scrollTop,
        46,
        24 * e.scale
      );
  }

  if (allDayGutter !== null) {
    allDayGutter.getBoundingClientRect = () =>
      new DOMRect(e.frameLeft, 84, e.zones * 46, 25);
  }

  document.elementFromPoint = (x, y) => {
    const index = Math.floor((x - e.frameLeft) / 46);

    if (y < 84) {
      return headers[index] ?? null;
    }

    return y < 109 ? allDayGutter : (labels[index] ?? null);
  };

  for (const element of columns) {
    const offset = Number(element.dataset.day) - first;
    element.getBoundingClientRect = () =>
      new DOMRect(
        e.frameLeft +
          e.zones * 46 +
          offset * e.columnWidth -
          viewport.scrollLeft,
        e.allDay ? 84 : 109 - viewport.scrollTop,
        e.columnWidth,
        e.allDay ? 25 : 24 * e.scale
      );

    for (const preview of element.querySelectorAll<HTMLElement>(
      ".gesture-preview"
    )) {
      if (e.scene === "narrow-preview") {
        const title = preview.querySelector<HTMLElement>(":scope > strong");

        if (title !== null) {
          Object.defineProperties(title, {
            clientWidth: { configurable: true, value: e.columnWidth - 18 },
            scrollWidth: { configurable: true, value: 300 },
          });
          title.getBoundingClientRect = () =>
            new DOMRect(0, 0, e.columnWidth - 18, 12);
        }
      }

      preview.getBoundingClientRect = () => {
        const cell = element.getBoundingClientRect();

        return new DOMRect(
          cell.left + 2,
          e.allDay ? 86 : cell.top + 9 * e.scale,
          e.columnWidth - 4,
          e.allDay ? 19 : e.scale - 2
        );
      };
    }
  }
};
