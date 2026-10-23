import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Match } from "effect";

import { touchResizeTarget } from "../src/client/editing/touch-resize.js";

it.effect.each([
  {
    expected: "start",
    height: 17,
    recipient: "blank",
    width: 40,
    x: 63,
    y: 63,
  },
  {
    expected: undefined,
    height: 17,
    recipient: "blank",
    width: 40,
    x: 107,
    y: 70,
  },
  {
    expected: undefined,
    height: 17,
    recipient: "selected",
    width: 40,
    x: 120,
    y: 108,
  },
  {
    expected: "end",
    height: 17,
    recipient: "blank",
    width: 40,
    x: 140,
    y: 130,
  },
  {
    expected: undefined,
    height: 17,
    recipient: "neighbour",
    width: 40,
    x: 100,
    y: 100,
  },
  {
    expected: undefined,
    height: 17,
    recipient: "control",
    width: 40,
    x: 100,
    y: 100,
  },
  {
    expected: "start",
    height: 17,
    recipient: "selected",
    width: 40,
    x: 100,
    y: 100,
  },
  {
    expected: "start",
    height: 8,
    recipient: "blank",
    width: 8,
    x: 102,
    y: 102,
  },
  { expected: "end", height: 8, recipient: "blank", width: 8, x: 106, y: 106 },
  {
    expected: "start",
    height: 8,
    recipient: "blank",
    width: 8,
    x: 104,
    y: 104,
  },
])(
  "corner resolver preserves body and neighbour ownership with explicit rectangular stand-ins: %j",
  (input) =>
    Effect.gen(function* cornerOwnership() {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("div");
          element.innerHTML =
            '<button class="event-chip selected"><span class="touch-resize-target" data-touch-resize-edge="start"></span><span class="touch-resize-target" data-touch-resize-edge="end"></span></button><button class="event-chip neighbour"></button><button class="unrelated-control"></button>';
          document.body.append(element);

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
          })
      );

      const selected = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".selected")
      );

      const neighbour = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".neighbour")
      );

      const control = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>(".unrelated-control")
      );

      const start = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>('[data-touch-resize-edge="start"]')
      );

      const end = yield* Effect.fromNullishOr(
        root.querySelector<HTMLElement>('[data-touch-resize-edge="end"]')
      );

      selected.getBoundingClientRect = () =>
        new DOMRect(100, 100, input.width, input.height);
      start.getBoundingClientRect = () => new DOMRect(63, 63, 44, 44);
      end.getBoundingClientRect = () =>
        new DOMRect(100 + input.width - 7, 100 + input.height - 7, 44, 44);

      const recipient = Match.value(input.recipient).pipe(
        Match.when("control", () => control),
        Match.when("neighbour", () => neighbour),
        Match.when("selected", () => selected),
        Match.orElse(() => root)
      );

      const event = new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: input.x,
        clientY: input.y,
        pointerType: "touch",
      });

      recipient.dispatchEvent(event);
      expect(touchResizeTarget(root, event)?.edge).toBe(input.expected);
      selected.classList.remove("selected");
      expect(touchResizeTarget(root, event)).toBeUndefined();
    })
);

it.effect(
  "coarse CSS declares non-clipping44px corners while fine-pointer7px handle rules remain unchanged",
  () =>
    Effect.gen(function* coarseDeclarations() {
      const fs = yield* FileSystem.FileSystem;
      const css = yield* fs.readFileString("src/client/style.css");

      const style = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const element = document.createElement("style");
          element.textContent = css;
          document.head.append(element);

          return element;
        }),
        (element) =>
          Effect.sync(() => {
            element.remove();
          })
      );

      const rules = [...(style.sheet?.cssRules ?? [])];

      const fine = rules.find(
        (rule) =>
          rule instanceof CSSStyleRule && rule.selectorText === ".resize-handle"
      );

      expect(fine instanceof CSSStyleRule && fine.style.height).toBe("7px");

      const coarse = rules.find(
        (rule) =>
          rule instanceof CSSMediaRule &&
          rule.conditionText.includes("any-pointer: coarse")
      );

      expect(coarse).toBeInstanceOf(CSSMediaRule);

      if (!(coarse instanceof CSSMediaRule)) {
        return;
      }

      expect(coarse.conditionText).toContain("max-width: 640px");

      const corner = [...coarse.cssRules].find(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.selectorText ===
            "#gesture-host .event-chip.selected .touch-resize-target"
      );

      expect(corner).toBeInstanceOf(CSSStyleRule);

      if (!(corner instanceof CSSStyleRule)) {
        return;
      }

      expect(corner.style.width).toBe("44px");
      expect(corner.style.height).toBe("44px");
      expect(corner.style.pointerEvents).toBe("none");
    }).pipe(Effect.provide(NodeServices.layer))
);
