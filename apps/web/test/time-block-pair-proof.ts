export const timeBlockPairProof = (
  family: string,
  width: number,
  theme: "light" | "dark"
): string => String.raw`(() => {
  const family = ${JSON.stringify(family)};
  const width = ${width};
  const theme = ${JSON.stringify(theme)};
  const require = (condition, message) => { if (!condition) throw new Error(family + ": " + message); };
  const standIn = window.__timeBlockStandIn === true;
  require(window.innerWidth === width, "exact viewport width");
  require(document.querySelector(".app").classList.contains("theme-" + theme), "same input theme");
  const visible = (element, label) => {
    require(element !== null, label + " exists");
    if (!standIn) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      require(element.getClientRects().length > 0 && box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden", label + " is physically visible");
    }
  };
  for (const dialog of document.querySelectorAll("dialog")) {
    if (!dialog.open) {
      if (standIn) dialog.setAttribute("open", "");
      else dialog.showModal();
    }
    require(dialog.open === true, "production native dialog is open before geometry");
    visible(dialog, "native dialog");
    const focus = document.getElementById(dialog.dataset.initialFocus || "") || dialog.querySelector("#keyboard-query,#time-zone-query,#event-title,[autofocus]") || dialog.querySelector("input,select,textarea,button");
    if (focus) focus.focus();
  }
  for (const menu of document.querySelectorAll('[role="menu"],[role="dialog"]:not(dialog)')) visible(menu, "production menu/dialog");
  const viewport = document.querySelector("#time-viewport");
  const content = document.querySelector(".time-content");
  visible(viewport, "time viewport");
  visible(content, "time content");
  require(document.querySelectorAll(".day-column").length > 0, "time grid, not Month/Search/Settings-only");
  require(!document.querySelector(".time-block-strip,.time-block-fill"), "blocks disabled on both sides");
  const labels = document.querySelectorAll(".time-labels span").length;
  require(labels >= 24 && labels % 24 === 0, "all normal hour labels remain");
  const scale = parseFloat(content.style.getPropertyValue("--hour-height"));
  require(Number.isFinite(scale) && Math.abs(parseFloat(content.style.height) - 24 * scale) < 0.001, "unchanged full-day extent");
  viewport.scrollTop = Math.max(0, 9 * scale - viewport.clientHeight / 3);
  const selected = document.querySelector(".event-chip.selected");
  const column = (selected && selected.closest(".day-column")) || document.querySelector(".today-column") || document.querySelector(".day-column");
  if (!standIn && column) {
    const gutter = document.querySelector(".time-labels");
    const gutterWidth = gutter ? gutter.getBoundingClientRect().width : 0;
    viewport.scrollLeft = Math.max(0, column.offsetLeft - (viewport.clientWidth - gutterWidth) / 3);
  }
  document.documentElement.dataset.pairFamily = family;
  document.documentElement.dataset.timeBlockPairProof = standIn ? "JSDOM stand-in; not browser proof" : "Production surfaces open; browser layout ready";
  document.documentElement.dataset.fixtureReady = "time-block-pair";
})();`;
