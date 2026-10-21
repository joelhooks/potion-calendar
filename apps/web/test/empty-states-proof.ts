import { runInNewContext } from "node:vm";

const standInLayoutBox = (
  element: Element,
  width: number,
  context: boolean
): DOMRect => {
  const sidebar = width <= 1000 ? 185 : 220;
  const panelWidth = width <= 1000 ? 260 : 300;
  const panel = context ? panelWidth : 0;
  const gridWidth = width - sidebar - panel;

  if (
    element.matches(".sidebar") ||
    element.closest(".calendar-row") !== null
  ) {
    return new DOMRect(0, 100, sidebar, 650);
  }

  if (element.matches("#time-viewport")) {
    return new DOMRect(sidebar, 100, gridWidth, 844);
  }

  if (
    element.matches("#upcoming-meeting") ||
    element.closest("#upcoming-meeting") !== null
  ) {
    return new DOMRect(width - panel, 100, panel, 300);
  }

  if (element.matches(".notification-stack,.calendar-read-notice")) {
    return new DOMRect(width - 400 - 24, 880, 400, 56);
  }

  if (element.matches(".event-chip")) {
    const top =
      element instanceof HTMLElement
        ? Number(element.style.top.replace("px", ""))
        : 0;

    return new DOMRect(
      sidebar + gridWidth / 7,
      100 + top,
      gridWidth / 7 - 4,
      24
    );
  }

  return new DOMRect(0, 0, width, 960);
};

export const executeEmptyStateProofWithStandInBoxes = (
  html: string,
  width: number
) => {
  const document = new DOMParser().parseFromString(html, "text/html");
  const context = document.querySelector("#upcoming-meeting") !== null;

  for (const element of document.querySelectorAll("*")) {
    Object.defineProperty(element, "getBoundingClientRect", {
      value: () => standInLayoutBox(element, width, context),
    });
  }

  Object.defineProperty(document.documentElement, "scrollWidth", {
    value: width,
  });
  const script = document.querySelector("script")?.textContent;

  if (script === undefined || script === null) {
    throw new Error("Exported fixture has no proof script");
  }

  runInNewContext(script, { document, innerHeight: 960, innerWidth: width });

  if (document.documentElement.dataset.emptyStatesProof !== "pass") {
    throw new Error("Exported proof did not finish");
  }

  return document;
};
