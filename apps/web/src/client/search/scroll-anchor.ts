import type { SearchScrollAnchor } from "./page-model.js";

export const measureSearchAnchor = (
  root: ParentNode
): typeof SearchScrollAnchor.Type | undefined => {
  const viewport = root.querySelector<HTMLElement>("#search-results");

  if (viewport === null) {
    return undefined;
  }

  const box = viewport.getBoundingClientRect();

  const row = [
    ...viewport.querySelectorAll<HTMLElement>(
      "[data-search-event],#search-today"
    ),
  ].find((element) => {
    const bounds = element.getBoundingClientRect();

    return bounds.bottom > box.top && bounds.top < box.bottom;
  });

  const key =
    row === undefined ? undefined : (row.dataset.searchEvent ?? row.id);

  return row === undefined || key === undefined
    ? undefined
    : {
        key,
        offset: row.getBoundingClientRect().top - box.top,
        position: viewport.scrollTop,
      };
};

export const restoreSearchAnchor = (
  root: ParentNode,
  anchor?: typeof SearchScrollAnchor.Type
): void => {
  const viewport = root.querySelector<HTMLElement>("#search-results");

  if (viewport === null) {
    return;
  }

  if (anchor === undefined) {
    viewport.dataset.searchRestoredPosition = String(viewport.scrollTop);

    return;
  }

  const saved = anchor;

  const row = [
    ...viewport.querySelectorAll<HTMLElement>(
      "[data-search-event],#search-today"
    ),
  ].find(
    (element) => (element.dataset.searchEvent ?? element.id) === saved.key
  );

  if (row === undefined) {
    viewport.scrollTop = saved.position;
  } else {
    const delta =
      row.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      saved.offset;

    viewport.scrollTop += delta;
  }

  viewport.dataset.searchRestoredPosition = String(viewport.scrollTop);
};
