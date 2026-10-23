import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message } from "../src/client/app.js";
import { canResumeHost } from "../src/client/grid-resume/host.js";
import { view } from "../src/features/app.js";
import { visibleDays } from "../src/layout/navigation.js";
import { visibleEvents } from "../src/layout/presentation.js";
import { phoneGridFixture, phoneGridScenes } from "./phone-grid-fixture.js";
import {
  mountPhoneGrid,
  phonePointer,
  phoneDom,
} from "./phone-grid-native-fixture.js";

const nativePan = (element: Element): string => {
  const style = document.querySelector<HTMLStyleElement>(
    "style[data-grid-touch-pan]"
  );

  const rules = [...(style?.sheet?.cssRules ?? [])].flatMap((rule) =>
    rule instanceof CSSMediaRule ? [...rule.cssRules] : []
  );

  const rule = rules.find(
    (candidate) =>
      candidate instanceof CSSStyleRule &&
      element.matches(candidate.selectorText)
  );

  return rule instanceof CSSStyleRule
    ? rule.style.getPropertyValue("touch-action")
    : "";
};

it.effect(
  "native vertical touch movement never captures, edits, swipes or selects a chip",
  () =>
    Effect.gen(function* vertical() {
      const scene = yield* mountPhoneGrid();
      const before = scene.read().calendar.navigation;

      const resume = {
        day: Number(scene.column.dataset.day),
        hostKey: scene.root.dataset.gestureHostKey ?? "",
      };

      expect(canResumeHost(document, resume)).toBe(true);

      for (const target of [scene.column, scene.chip]) {
        const down = phonePointer(target, "pointerdown", 180, 200);
        yield* phoneDom(() => scene.root.dataset.touchPhase === "pending");
        expect(down.defaultPrevented).toBe(false);
        expect(scene.captures.size).toBe(0);
        const move = phonePointer(window, "pointermove", 240, 280);
        yield* phoneDom(() => scene.root.dataset.touchPhase !== "pending");
        expect(scene.root.dataset.touchPhase).toBe("scrolling");
        expect(canResumeHost(document, resume)).toBe(false);
        expect(move.defaultPrevented).toBe(false);
        expect(scene.root.dataset.gesturePhase).toBe("idle");
        expect(scene.captures.size).toBe(0);
        phonePointer(window, "pointerup", 240, 300);
        yield* phoneDom(() => scene.root.dataset.touchPhase === "idle");

        const click = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        });

        target.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
      }

      expect(scene.read().calendar.navigation).toEqual(before);
      expect(scene.read().calendar.selected).toHaveLength(0);
      expect(scene.commands).not.toContain("DispatchEditing");
      expect(scene.commands).not.toContain("SavePreferences");
      expect(nativePan(scene.chip)).toBe("pan-y pinch-zoom");
      expect(nativePan(scene.column)).toBe("pan-y pinch-zoom");

      const allDay = yield* Effect.fromNullishOr(
        scene.root.querySelector(".all-day-cell")
      );

      expect(nativePan(allDay)).toBe("pan-y pinch-zoom");
    }).pipe(Effect.scoped)
);

it.effect(
  "a qualifying native swipe captures only after intent and reaches existing period navigation once",
  () =>
    Effect.gen(function* swipe() {
      const scene = yield* mountPhoneGrid();
      const before = scene.read().calendar.navigation.anchor;
      phonePointer(scene.column, "pointerdown", 200, 200);
      yield* phoneDom(() => scene.root.dataset.touchPhase === "pending");
      expect(scene.captures.size).toBe(0);
      phonePointer(window, "pointermove", 153, 202);
      expect(scene.captures.size).toBe(0);
      const move = phonePointer(window, "pointermove", 152, 202);
      expect(move.defaultPrevented).toBe(false);
      yield* phoneDom(() => scene.root.dataset.touchPhase !== "pending");
      expect(scene.root.dataset.touchPhase).toBe("swiping");
      expect(scene.captures.has(1)).toBe(true);
      expect(scene.transfers).toEqual([1]);
      expect(scene.root.dataset.touchPhase).toBe("swiping");
      expect(
        phonePointer(window, "pointermove", 151, 202).defaultPrevented
      ).toBe(true);
      phonePointer(window, "pointerup", 151, 202);
      yield* scene.notice("PhoneSwipedPeriod");
      expect(scene.read().calendar.navigation.anchor).toBe(before + 1);
      expect(scene.captures.size).toBe(0);
      phonePointer(window, "pointerup", 100, 200);
      expect(scene.read().calendar.navigation.anchor).toBe(before + 1);

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });

      scene.root.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(scene.read().calendar.selected).toHaveLength(0);
      expect(scene.commands).not.toContain("DispatchEditing");
    }).pipe(Effect.scoped)
);

it.effect(
  "a native chip tap preserves the normal Foldkit click and opens M1 details from the real root recipient",
  () =>
    Effect.gen(function* tap() {
      const scene = yield* mountPhoneGrid();
      const key = scene.chip.dataset.eventKey;
      phonePointer(scene.chip, "pointerdown", 180, 200);
      yield* phoneDom(() => scene.root.dataset.touchPhase === "pending");
      phonePointer(window, "pointerup", 180, 200);
      yield* phoneDom(() => scene.root.dataset.touchPhase === "idle");
      scene.chip.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      yield* scene.notice("ClickedEvent");
      expect(scene.read().calendar.selected).toEqual([key]);
      expect(scene.read().phoneShell.mode).toBe("details");
      scene.send(Message.PhoneShellClosed());
      yield* scene.notice("PhoneShellClosed");
      expect(scene.read().phoneShell.mode).toBe("closed");
      expect(scene.read().calendar.selected).toEqual([key]);
      expect(scene.commands).not.toContain("DispatchEditing");
    }).pipe(Effect.scoped)
);

it.effect(
  "touch cancellation and a second finger cancel before editing while mouse and pen retain eager editing capture",
  () =>
    Effect.gen(function* cancel() {
      const scene = yield* mountPhoneGrid();
      const before = scene.read().calendar.navigation;
      phonePointer(scene.column, "pointerdown", 200, 200);
      yield* phoneDom(() => scene.root.dataset.touchPhase === "pending");
      phonePointer(scene.column, "pointerdown", 210, 210, "touch", 2, false);
      yield* phoneDom(() => scene.root.dataset.touchPhase === "idle");
      phonePointer(window, "pointermove", 100, 200);
      phonePointer(window, "pointerup", 100, 200);
      expect(scene.read().calendar.navigation).toEqual(before);
      expect(scene.root.dataset.gesturePhase).toBe("idle");

      for (const pointerType of ["mouse", "pen"]) {
        phonePointer(scene.column, "pointerdown", 180, 200, pointerType);
        yield* phoneDom(() => scene.root.dataset.gesturePhase === "armed");
        expect(scene.captures.has(1)).toBe(true);
        phonePointer(window, "pointercancel", 180, 200, pointerType);
        yield* phoneDom(() => scene.root.dataset.gesturePhase === "idle");

        if (scene.captures.has(1)) {
          scene.root.releasePointerCapture(1);
        }
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "phone Month remains compact at 640 px instead of packing 44 px targets into desktop chip rows",
  () =>
    Effect.gen(function* monthPhoneBoundary() {
      const base = phoneGridFixture(phoneGridScenes[2]);

      for (const width of [640, 641]) {
        const model = {
          ...base,
          calendar: { ...base.calendar, viewportWidth: width },
          phoneShell: { ...base.phoneShell, viewportWidth: width },
        };

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const dom = new DOMParser().parseFromString(rendered.html, "text/html");

        if (width === 640) {
          expect(
            dom.querySelectorAll(".phone-month-summary").length
          ).toBeGreaterThan(0);
          expect(dom.querySelectorAll(".month-view .event-chip")).toHaveLength(
            0
          );
        } else {
          expect(dom.querySelectorAll(".phone-month-summary")).toHaveLength(0);
          expect(
            dom.querySelectorAll(".month-view .event-chip").length
          ).toBeGreaterThan(0);
        }
      }
    }).pipe(Effect.scoped)
);

it.effect(
  "phone day and travel projections fit their declared viewport and month counts include timed and spanning events",
  () =>
    Effect.gen(function* phoneGridRenderings() {
      for (const item of phoneGridScenes) {
        const model = phoneGridFixture(item);

        const rendered = yield* renderToString(
          { init: () => ({ model }), view },
          { isHydratable: false }
        );

        const dom = new DOMParser().parseFromString(rendered.html, "text/html");
        expect(model.timeZones.preferences.secondary).toHaveLength(3);

        if (item.scene === "month") {
          expect(dom.querySelectorAll(".event-chip")).toHaveLength(0);
          expect(dom.querySelectorAll(".month-span")).toHaveLength(0);
          const events = visibleEvents(model);

          for (const cell of dom.querySelectorAll<HTMLElement>(
            "[data-phone-month-count]"
          )) {
            const day = Number(cell.dataset.day);
            expect(Number(cell.dataset.phoneMonthCount)).toBe(
              events.filter(
                (event) => event.startDay <= day && day < event.endDay
              ).length
            );
          }
        } else {
          expect(visibleDays(model.calendar.navigation)).toHaveLength(1);

          const zones = [
            ...dom.querySelectorAll<HTMLElement>(".zone-header"),
          ].map((node) => node.dataset.zoneId);

          expect(zones).toEqual([
            model.timeZones.preferences.primary.id,
            ...(item.scene === "travel" ? ["Europe/Paris"] : []),
          ]);
          expect(dom.querySelectorAll("[data-zone-drag-id]")).toHaveLength(0);

          const total = Number(
            dom
              .querySelector<HTMLElement>(".day-headers")
              ?.style.width.replace(/px$/u, "")
          );

          expect(total).toBe(item.width);
        }
      }
    }).pipe(Effect.scoped)
);
