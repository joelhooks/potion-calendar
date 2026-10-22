export const zoneDragProofScript = (
  phase: "marker" | "drop",
  width: number
) => `(() => {
  const phase = ${JSON.stringify(phase)};
  const width = ${width};
  const require = (value, message) => { if (!value) throw new Error(message); };
  const standIn = window.__zoneDragStandIn === true;
  const expected = phase === "marker"
    ? ["America/New_York", "Europe/London", "America/Los_Angeles", "Asia/Tokyo"]
    : ["Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];
  const headers = [...document.querySelectorAll(".zone-header")];
  require(JSON.stringify(headers.map((node) => node.dataset.zoneId)) === JSON.stringify(expected), "actual header order");
  require(JSON.stringify([...document.querySelectorAll(".time-labels")].map((node) => node.dataset.zoneId)) === JSON.stringify(expected), "hour gutters match saved order");
  require(document.querySelectorAll("button[data-zone-drag-id]").length === 2, "only secondary handles");
  for (const id of ["America/Los_Angeles", "Asia/Tokyo"]) {
    const header = headers.find((node) => node.dataset.zoneId === id);
    require(header && !header.querySelector("button[data-zone-drag-id]"), "primary and travel fixed");
  }
  const markers = [...document.querySelectorAll(".zone-insert-marker")];
  require(markers.length === (phase === "marker" ? 1 : 0), "marker lifetime");
  if (phase === "marker") {
    const marker = markers[0];
    const primary = headers[2];
    require(marker.dataset.zoneInsertIndex === "1" && marker.parentElement === primary, "insert after last secondary, before primary");
    if (!standIn) {
      const bounds = marker.getBoundingClientRect();
      const header = primary.getBoundingClientRect();
      require(bounds.width > 0 && bounds.width <= 2.1 && bounds.height > 0, "visible thin marker");
      require(Math.abs(bounds.left - header.left) <= 1 && Math.abs(bounds.top - header.top) <= 1, "marker at header boundary");
      const viewport = document.querySelector("#time-viewport");
      const before = bounds.left;
      viewport.scrollLeft = Math.min(50, viewport.scrollWidth - viewport.clientWidth);
      require(Math.abs(marker.getBoundingClientRect().left - before) <= 1, "marker remains with sticky gutters");
      viewport.scrollLeft = 0;
    }
  }
  if (!standIn) {
    require(window.innerWidth === width, "requested width");
    require(document.documentElement.scrollWidth <= window.innerWidth + 1, "no horizontal page overflow");
    require(headers.every((node) => node.getBoundingClientRect().width > 0), "actual visible headers");
  }
  document.documentElement.dataset.zoneDragProof = standIn ? "JSDOM stand-in; not browser proof" : "browser";
  document.documentElement.dataset.fixtureReady = "zone-drag";
})();`;
