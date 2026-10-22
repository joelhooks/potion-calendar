import type { TimeBlockScene } from "./time-block-fixture.js";

export interface TimeBlockProof {
  readonly scene: TimeBlockScene;
  readonly theme: "light" | "dark";
  readonly width: number;
  readonly scale: number;
  readonly phase: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly steps: readonly {
    readonly type: string;
    readonly minute: number;
    readonly y: number;
  }[];
}

export const timeBlockProofScript = (
  proof: TimeBlockProof
): string => String.raw`(() => {
  const proof = ${JSON.stringify(proof)};
  const require = (condition, message) => { if (!condition) throw new Error("Time blocks: " + message); };
  const close = (actual, expected, label) => require(Number.isFinite(actual) && Math.abs(actual - expected) <= 0.51, label + ": " + actual + " != " + expected);
  const standIn = window.__timeBlockStandIn === true;
  require(window.innerWidth === proof.width, "exact viewport width");
  require(document.querySelector(".app").classList.contains("theme-" + proof.theme), "exact theme");
  if (proof.scene.startsWith("settings-")) {
    const section = document.querySelector(".time-block-settings");
    require(section && section.textContent.includes("Time blocks"), "Settings section");
    const enabled = section.querySelector("#time-blocks-enabled");
    require(enabled && enabled.checked === (proof.scene !== "settings-empty"), "saved enable state");
    if (!standIn) section.scrollIntoView({ block: "start" });
    if (proof.scene === "settings-empty") {
      require(section.querySelector(".time-block-empty") && !section.querySelector("form"), "empty list and no suggested schedule");
    } else if (proof.scene === "settings-list") {
      require(section.querySelectorAll(".time-block-item").length === 3, "three explicit persisted blocks");
      require(section.textContent.includes("Quiet time") && section.textContent.includes("Break"), "named list");
    } else {
      const form = section.querySelector("form");
      require(form && section.querySelector("#time-block-name").value === "Quiet time", "editing existing name");
      if (!standIn) {
        const box = form.getBoundingClientRect();
        require(form.getClientRects().length > 0 && box.width > 0 && box.height > 0 && getComputedStyle(form).display !== "none", "production inline Settings editor is visible before field checks");
      }
      require(section.querySelector("#time-block-start-0").value === "11:00", "explicit start value");
      require(section.querySelector("#time-block-end-0").value === (proof.scene === "settings-error" ? "09:00" : "12:00"), "incomplete draft retained");
      require((section.querySelector('[role="alert"]') !== null) === (proof.scene === "settings-error"), "validation failure remains outside saved preferences");
      if (proof.scene === "settings-error") {
        const end = section.querySelector("#time-block-end-0");
        require(end.getAttribute("aria-invalid") === "true", "invalid end marked");
        require(end.getAttribute("aria-describedby") === "time-block-end-0-error", "invalid end describes its range error");
        require(section.querySelector("#time-block-end-0-error").textContent === "End must be after start.", "specific range failure");
      }
    }
  } else {
    const viewport = document.querySelector("#time-viewport");
    const body = document.querySelector(".time-content");
    const column = document.querySelector('.day-column[data-day="20747"]');
    require(viewport && body && column, "October 21 recipient column");
    const y = (minute) => Math.min(minute, 660) * proof.scale / 60 + Math.max(0, Math.min(120, minute - 660)) * 24 / 120 + Math.max(0, minute - 780) * proof.scale / 60;
    close(parseFloat(body.style.height), y(1440), "compressed grid extent");
    const strips = column.querySelectorAll(".time-block-strip");
    require(strips.length === 1, "touching hidden ranges merge before layout");
    close(parseFloat(strips[0].style.height), 24, "24 px strip");
    close(parseFloat(strips[0].style.top), y(660), "strip boundary");
    require(strips[0].textContent.includes("Quiet time") && strips[0].textContent.includes("Break"), "merged strip preserves names");
    const labels = Array.from(document.querySelectorAll(".time-labels [data-minute]"));
    require(labels.length === 22 && !labels.some((label) => label.dataset.minute === "660" || label.dataset.minute === "720"), "hidden minutes have no ticks");
    for (const label of labels) close(parseFloat(label.style.top), y(Number(label.dataset.minute)), "compressed tick");
    const chip = column.querySelector(".event-chip.selected");
    const preview = column.querySelector(".gesture-preview");
    require(chip && preview, "selected straddling chip and active preview");
    close(parseFloat(chip.style.top), y(630), "straddling chip top");
    close(parseFloat(chip.style.height), Math.max(16, y(810) - y(630) - 2), "chip endpoint difference");
    close(parseFloat(preview.style.top), y(810), "dragged preview top");
    close(parseFloat(preview.style.height), Math.max(16, y(990) - y(810) - 2), "preview endpoint difference");
    require(proof.phase === "dragging" && proof.startTime === "13:30" && proof.endTime === "16:30", "frozen native pointer snapshot preserves real duration across strip");
    require(proof.steps.length === 2 && proof.steps[0].type === "pointerdown" && proof.steps[0].minute === 645 && proof.steps[1].type === "pointermove" && proof.steps[1].minute === 825, "native pointer step history");
    close(proof.steps[1].y - proof.steps[0].y, y(825) - y(645), "compressed pointer distance");
    viewport.scrollTop = Math.max(0, y(540) - 100);
    if (!standIn) {
      const gutter = document.querySelector(".time-labels");
      const available = viewport.clientWidth - gutter.getBoundingClientRect().width;
      viewport.scrollLeft = Math.max(0, column.offsetLeft - gutter.getBoundingClientRect().width - available / 3);
      close(strips[0].getBoundingClientRect().height, 24, "browser strip layout");
      close(chip.getBoundingClientRect().top - column.getBoundingClientRect().top, y(630), "browser chip top");
      close(preview.getBoundingClientRect().top - column.getBoundingClientRect().top, y(810), "browser preview top");
      require(getComputedStyle(strips[0]).pointerEvents === "none", "strip does not block gestures");
      require(getComputedStyle(column.querySelector(".time-block-fill")).pointerEvents === "none", "colour does not block gestures");
      require(getComputedStyle(document.querySelector(".day-columns")).backgroundImage === "none", "no ghost linear ticks");
    }
  }
  document.documentElement.dataset.timeBlockProof = standIn ? "JSDOM stand-in; not browser proof" : "Browser layout of frozen native pointer snapshot";
  document.documentElement.dataset.fixtureReady = "time-blocks";
})();`;
