export interface DayHeadersProof {
  readonly width: number;
  readonly panel: "open" | "closed";
  readonly floor: boolean;
  readonly dayWidth: number;
  readonly labels: readonly string[];
  readonly ariaLabels: readonly string[];
  readonly today: number;
}

export const dayHeadersProofScript = (proof: DayHeadersProof) => `(() => {
  const expected = ${JSON.stringify(proof)};
  const require = (value, message) => { if (!value) throw new Error(message); };
  const standIn = window.__dayHeadersStandIn === true;
  const headers = [...document.querySelectorAll(".day-header")];
  require(headers.length === expected.labels.length, "all dates rendered");
  require(document.querySelectorAll(".zone-header").length === 4, "four zones rendered");
  require(document.querySelectorAll(".detail-panel").length === (expected.panel === "open" ? 1 : 0), "requested details state");
  require(document.querySelectorAll(".upcoming-panel").length === 0, "no unexpected context panel");
  for (const [index, header] of headers.entries()) {
    const label = header.querySelector(".day-header-label");
    require(label && label.textContent === expected.labels[index], "width-derived label text");
    require(header.getAttribute("aria-label") === expected.ariaLabels[index], "full accessible date");
    require(header.classList.contains("is-today") === (Number(header.dataset.day) === expected.today), "today class preserved");
    require(header.dataset.dayHeaderForm === (expected.floor ? "number" : "full"), "requested form");
  }
  const today = headers.find((header) => Number(header.dataset.day) === expected.today);
  require(today && today.classList.contains("is-today"), "today visible");
  if (!standIn) {
    require(window.innerWidth === expected.width, "requested viewport");
    require(document.documentElement.scrollWidth <= expected.width + 1, "no horizontal page overflow");
    const boxes = headers.map((header) => {
      const box = header.getBoundingClientRect();
      const label = header.querySelector(".day-header-label");
      const text = label.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(label);
      const ink = range.getBoundingClientRect();
      require(Math.abs(box.width - expected.dayWidth) <= 0.75, "real computed column width");
      require(text.width > 0 && ink.width > 0, "visible label");
      require(ink.left >= box.left - 0.75 && ink.right <= box.right + 0.75, "text fits its own date column");
      return text;
    });
    for (let index = 1; index < boxes.length; index += 1) {
      require(boxes[index - 1].right <= boxes[index].left + 0.75, "neighbor label boxes never intersect");
    }
    require(Number(getComputedStyle(today).fontWeight) >= 700, "today emphasis retained");
  }
  document.documentElement.dataset.dayHeadersProof = standIn ? "JSDOM stand-in; not browser proof" : "browser";
  document.documentElement.dataset.fixtureReady = "day-headers";
})();`;
