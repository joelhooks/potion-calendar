import { expect, it } from "@effect/vitest";
import {
  Effect,
  Exit,
  Option,
  Predicate,
  Queue,
  Ref,
  Scope,
  Stream,
} from "effect";
import { renderToString } from "foldkit/experimental/server";
import { vi } from "vitest";

import { update } from "../src/client/app.js";
import type { AppMessage, AppModel } from "../src/client/app.js";
import { observeKeyboard } from "../src/client/keyboard/input.js";
import { PrepareSelection } from "../src/client/selection/mount.js";
import { view } from "../src/features/app.js";
import { SettingsRoute } from "../src/layout/route.js";
import { bulkRootFixture } from "./bulk-root-fixture.js";

const takeMessage = (queue: Queue.Queue<AppMessage>, tag: AppMessage["_tag"]) =>
  Stream.fromQueue(queue).pipe(
    Stream.filter((message) => message._tag === tag),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption)
  );

const pointer = (target: Element, type: string, x: number, y: number) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: x,
    clientY: y,
    shiftKey: true,
  });

  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: 7 },
    pointerType: { value: "mouse" },
  });
  target.dispatchEvent(event);
};

const mountFixture = Effect.fn("mountBulkSelectionFixture")(
  function* mountFixture(month: boolean) {
    const fixture = bulkRootFixture(month);

    const rendered = yield* renderToString(
      { init: () => ({ model: fixture.model }), view },
      { isHydratable: false }
    );

    const container = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const element = document.createElement("div");
        element.innerHTML = rendered.html;
        document.body.append(element);

        return element;
      }),
      (element) =>
        Effect.sync(() => {
          element.remove();
        })
    );

    const grid = container.querySelector<HTMLElement>(
      month ? ".month-view" : ".time-view"
    );

    const root = month
      ? grid?.querySelector<HTMLElement>(".month-weekdays")?.parentElement
      : grid?.parentElement;

    if (grid === null || root === undefined || root === null) {
      return yield* Effect.die("The actual selection surface is missing.");
    }

    grid.getBoundingClientRect = () => new DOMRect(0, 0, 400, 500);

    const viewport = container.querySelector<HTMLElement>(
      month ? "#month-viewport" : "#time-viewport"
    );

    if (viewport !== null) {
      viewport.getBoundingClientRect = () =>
        new DOMRect(0, month ? 0 : 100, 400, month ? 500 : 400);
    }

    const allDay = container.querySelector<HTMLElement>(".all-day");

    if (allDay !== null) {
      allDay.getBoundingClientRect = () => new DOMRect(0, 0, 400, 100);
    }

    const chips = fixture.keys.map((key, index) => {
      const chip = [...root.querySelectorAll<HTMLElement>(".event-chip")].find(
        (element) => element.dataset.eventKey === key
      );

      if (chip === undefined) {
        throw new Error("The rendered saved event is missing.");
      }

      const rect = new DOMRect(
        40,
        index === 2 ? 40 : 150 + index * 110,
        100,
        index === 2 ? 24 : 80
      );

      chip.getBoundingClientRect = () => rect;
      chip.getClientRects = () =>
        Object.assign([rect], {
          item: (position: number) => (position === 0 ? rect : null),
        });

      return chip;
    });

    const state = yield* Ref.make<AppModel>(fixture.model);
    const messages = yield* Queue.unbounded<AppMessage>();
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer((exit) => Scope.close(scope, exit));
    yield* PrepareSelection({
      hostKey: fixture.hostKey,
      personId: fixture.personId,
    })
      .f(root, Stream.empty)
      .pipe(
        Stream.runForEach((message) =>
          Ref.update(state, (model) => update(model, message).model).pipe(
            Effect.andThen(Queue.offer(messages, message))
          )
        ),
        Effect.forkIn(scope)
      );
    yield* takeMessage(messages, "PreparedSelection");

    return {
      ...fixture,
      chips,
      container,
      grid,
      messages,
      release: Scope.close(scope, Exit.void),
      root,
      state,
    };
  }
);

it.effect(
  "native Mod-A selects the actual calendar range but leaves text inputs and Settings page selection to the host",
  () =>
    Effect.gen(function* nativeSelectAll() {
      const h = yield* mountFixture(false);

      const key = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "a",
      });

      h.root.dispatchEvent(key);
      const handled = observeKeyboard(h.model, key, 10);

      expect(Option.isSome(handled)).toBe(true);
      expect(key.defaultPrevented).toBe(true);

      if (Option.isNone(handled)) {
        return yield* Effect.die("Calendar select-all was not dispatched.");
      }

      expect(update(h.model, handled.value).model.calendar.selected).toEqual(
        h.keys
      );
      const input = document.createElement("textarea");
      h.root.append(input);

      const text = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "a",
      });

      input.dispatchEvent(text);
      expect(Option.isNone(observeKeyboard(h.model, text, 10))).toBe(true);
      expect(text.defaultPrevented).toBe(false);

      const settings = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "a",
      });

      h.root.dispatchEvent(settings);
      expect(
        Option.isNone(
          observeKeyboard(
            { ...h.model, route: SettingsRoute.make({ page: "general" }) },
            settings,
            10
          )
        )
      ).toBe(true);
      expect(settings.defaultPrevented).toBe(false);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "Mac selection uses Command rather than Control and does not remap a non-platform modifier",
  () =>
    Effect.gen(function* macSelection() {
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel")
        ),
        (mock) =>
          Effect.sync(() => {
            mock.mockRestore();
          })
      );
      const h = yield* mountFixture(false);
      const [alpha] = h.chips;

      if (alpha === undefined) {
        return yield* Effect.die("Missing Mac selection fixture.");
      }

      const bubble = vi.fn(() => {});
      h.root.addEventListener("click", bubble);
      alpha.dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true })
      );
      expect(bubble).toHaveBeenCalledOnce();
      expect((yield* Ref.get(h.state)).calendar.selected).toEqual([]);
      alpha.dispatchEvent(
        new MouseEvent("click", { bubbles: true, metaKey: true })
      );
      yield* takeMessage(h.messages, "ModifiedEventSelection");
      expect((yield* Ref.get(h.state)).calendar.selected).toEqual([h.keys[0]]);
      expect(bubble).toHaveBeenCalledOnce();

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each([false, true])(
  "actual week/month selection mount routes native modifier clicks once and releases them with the host (%s)",
  (month) =>
    Effect.gen(function* modifierClicks() {
      const h = yield* mountFixture(month);
      const [alpha, beta] = h.chips;

      if (alpha === undefined || beta === undefined) {
        return yield* Effect.die("Missing native click fixture.");
      }

      const bubble = vi.fn(() => {});
      h.root.addEventListener("click", bubble);
      alpha.dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true })
      );
      yield* takeMessage(h.messages, "ModifiedEventSelection");
      beta.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true })
      );
      yield* takeMessage(h.messages, "ModifiedEventSelection");
      expect((yield* Ref.get(h.state)).calendar.selected).toEqual(
        h.keys.slice(0, 2)
      );
      expect(bubble).not.toHaveBeenCalled();
      alpha.dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true })
      );
      yield* takeMessage(h.messages, "ModifiedEventSelection");
      expect((yield* Ref.get(h.state)).calendar.selected).toEqual([h.keys[1]]);
      yield* h.release;
      alpha.dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true })
      );
      expect(bubble).toHaveBeenCalledOnce();
      expect((yield* Ref.get(h.state)).calendar.selected).toEqual([h.keys[1]]);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect.each([false, true])(
  "Shift rectangle replaces rather than adds, includes visible clipped fragments once and suppresses the generated click (%s)",
  (month) =>
    Effect.gen(function* rectangleBinding() {
      const h = yield* mountFixture(month);
      const [alpha, beta, gamma] = h.chips;

      const surface = h.root.querySelector(
        month ? ".month-cell[data-day]" : ".day-column"
      );

      if (
        alpha === undefined ||
        beta === undefined ||
        gamma === undefined ||
        surface === null
      ) {
        return yield* Effect.die("Missing rectangle fixture.");
      }

      beta.dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true })
      );
      yield* takeMessage(h.messages, "ModifiedEventSelection");
      const duplicate = gamma.cloneNode(true);

      if (!(duplicate instanceof HTMLElement)) {
        return yield* Effect.die("Invalid cloned rendered fragment.");
      }

      const clipped = new DOMRect(-80, 20, 100, 24);
      duplicate.getClientRects = () =>
        Object.assign([clipped], {
          item: (index: number) => (index === 0 ? clipped : null),
        });
      gamma.parentElement?.append(duplicate);
      const hidden = beta.cloneNode(true);

      if (!(hidden instanceof HTMLElement)) {
        return yield* Effect.die("Invalid hidden fragment.");
      }

      const outside = new DOMRect(40, month ? 510 : 60, 100, 24);
      hidden.getClientRects = () =>
        Object.assign([outside], {
          item: (index: number) => (index === 0 ? outside : null),
        });
      alpha.parentElement?.append(hidden);
      pointer(surface, "pointerdown", 0, 0);
      pointer(h.root, "pointermove", 180, 245);
      yield* takeMessage(h.messages, "PreviewedSelectionRectangle");
      expect(Option.isSome((yield* Ref.get(h.state)).calendar.rectangle)).toBe(
        true
      );
      pointer(h.root, "pointerup", 180, 245);
      yield* takeMessage(h.messages, "SelectedRectangle");
      const model = yield* Ref.get(h.state);

      expect(model.calendar.selected.toSorted()).toEqual(
        h.keys.filter((_, index) => index === 0 || index === 2).toSorted()
      );
      expect(model.calendar.selected).toHaveLength(2);
      expect(Option.isNone(model.calendar.rectangle)).toBe(true);
      const bubble = vi.fn(() => {});
      h.root.addEventListener("click", bubble);
      alpha.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1, shiftKey: true })
      );
      expect(bubble).not.toHaveBeenCalled();

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);

it.effect(
  "Escape cancels rectangle ownership before pointer-up, while Shift-click stays a toggle and never creates an event range",
  () =>
    Effect.gen(function* cancelRectangle() {
      const h = yield* mountFixture(false);
      const [alpha] = h.chips;

      if (alpha === undefined) {
        return yield* Effect.die("Missing shift-click fixture.");
      }

      pointer(alpha, "pointerdown", 50, 160);
      pointer(h.root, "pointerup", 50, 160);
      alpha.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1, shiftKey: true })
      );
      yield* takeMessage(h.messages, "ModifiedEventSelection");
      expect((yield* Ref.get(h.state)).calendar.selected).toEqual([h.keys[0]]);
      pointer(alpha, "pointerdown", 50, 160);
      pointer(h.root, "pointermove", 180, 300);
      yield* takeMessage(h.messages, "PreviewedSelectionRectangle");
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
      );
      yield* Stream.fromQueue(h.messages).pipe(
        Stream.filter(
          (message) =>
            Predicate.isTagged(message, "PreviewedSelectionRectangle") &&
            Option.isNone(message.box)
        ),
        Stream.runHead
      );
      pointer(h.root, "pointerup", 180, 300);
      const model = yield* Ref.get(h.state);

      expect(model.calendar.selected).toEqual([h.keys[0]]);
      expect(model.editing.view._tag).toBe("Closed");
      expect(Option.isNone(model.calendar.rectangle)).toBe(true);

      return yield* Effect.void;
    }).pipe(Effect.scoped)
);
