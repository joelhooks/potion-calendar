import { runInNewContext } from "node:vm";

import { expect } from "@effect/vitest";
import { Effect } from "effect";

import { timeZonesProofScript } from "./time-zones-proof.js";

export const verifyTimeZonesExport = Effect.fn("verifyTimeZonesExport")(
  function* verifyTimeZonesExport(
    exported: string,
    width: number,
    minimum: number
  ) {
    const { document } = globalThis;
    const container = document.createElement("div");
    container.innerHTML = exported;

    const descriptor = Object.getOwnPropertyDescriptor(
      document.documentElement,
      "scrollWidth"
    );

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        document.body.append(container);
        Object.defineProperty(document.documentElement, "scrollWidth", {
          configurable: true,
          value: width,
        });
        document.documentElement.dataset.scriptGeometry =
          "JSDOM stand-in boxes, not browser layout";
      }),
      () =>
        Effect.sync(() => {
          container.remove();

          if (descriptor === undefined) {
            Reflect.deleteProperty(document.documentElement, "scrollWidth");
          } else {
            Object.defineProperty(
              document.documentElement,
              "scrollWidth",
              descriptor
            );
          }

          Reflect.deleteProperty(
            document.documentElement.dataset,
            "scriptGeometry"
          );
        })
    );

    const frame = yield* Effect.fromNullishOr(
      container.querySelector<HTMLElement>("#time-viewport")
    );

    const panel = yield* Effect.fromNullishOr(
      container.querySelector<HTMLElement>(".detail-panel,.upcoming-panel")
    );

    const sidebar = width <= 1000 ? 185 : 220;
    const contextWidth = width <= 1000 ? 260 : 300;

    frame.getBoundingClientRect = () =>
      new DOMRect(sidebar, 56, width - sidebar - contextWidth, 844);
    panel.getBoundingClientRect = () =>
      new DOMRect(width - contextWidth, 56, contextWidth, 844);

    for (const day of container.querySelectorAll<HTMLElement>(".day-column")) {
      day.getBoundingClientRect = () => new DOMRect(0, 0, minimum, 900);
    }

    for (const selector of [".zone-header", ".time-labels"]) {
      const gutters = container.querySelectorAll<HTMLElement>(selector);

      for (const [index, gutter] of gutters.entries()) {
        gutter.getBoundingClientRect = () =>
          new DOMRect(sidebar + index * 46, 56, 46, 844);
      }
    }

    const allDay = yield* Effect.fromNullishOr(
      container.querySelector<HTMLElement>(".all-day-gutter")
    );

    const headers = yield* Effect.fromNullishOr(
      container.querySelector<HTMLElement>(".day-headers")
    );

    allDay.getBoundingClientRect = () => new DOMRect(sidebar, 84, 184, 25);
    headers.getBoundingClientRect = () => new DOMRect(sidebar, 56, 455, 28);
    const script = container.querySelector("script")?.textContent;
    expect(script).toBe(timeZonesProofScript(minimum));
    const context = { document, innerWidth: width };
    runInNewContext(script ?? "throw Error('Missing exact script')", context);
    expect(document.documentElement.dataset.zoneLayoutProof).toBe("pass");
    expect(document.documentElement.dataset.zoneLayoutGeometry).toContain(
      "JSDOM stand-in"
    );

    const loading = document.createElement("p");
    loading.textContent = "Loading upcoming meetings…";
    panel.append(loading);
    expect(() => {
      runInNewContext(script ?? "", context);
    }).toThrow(/Unsettled calendar fixture/u);
    loading.remove();

    panel.getBoundingClientRect = () =>
      new DOMRect(width - contextWidth + 20, 56, contextWidth, 844);
    expect(() => {
      runInNewContext(script ?? "", context);
    }).toThrow(/Grid leaves blank strip/u);
  }
);
