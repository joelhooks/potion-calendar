import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Stream } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Message, update } from "../src/client/app.js";
import { PrepareEditingDialogs } from "../src/client/editing/dialog-mount.js";
import { view } from "../src/features/app.js";
import { stagedCommandColorFixture } from "./command-color-editor-fixture.js";
import { reminderCardScene } from "./reminder-card-fixture.js";

const focusAfterMutation = (element: Element, change: () => void) =>
  Effect.callback<string>((resume) => {
    const observer = new MutationObserver(() => {
      resume(Effect.succeed(document.activeElement?.id ?? ""));
    });

    observer.observe(element, {
      attributeFilter: ["data-initial-focus"],
      attributes: true,
      subtree: true,
    });
    change();

    return Effect.sync(() => {
      observer.disconnect();
    });
  });

it.effect(
  "the production editor mount focuses the staged swatch, retargets calendar reset and preserves typing on reminder arrival",
  () =>
    Effect.gen(function* colorFocus() {
      const staged = yield* stagedCommandColorFixture();

      const rendered = yield* renderToString(
        { init: () => ({ model: staged.model }), view },
        { isHydratable: false }
      );

      const element = document.createElement("div");
      element.innerHTML = rendered.html;
      document.body.append(element);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          element.remove();
        })
      );

      const dialog = yield* Effect.fromOption(
        Option.fromNullishOr(
          element.querySelector<HTMLDialogElement>("#event-editor-dialog")
        )
      );

      Object.defineProperty(dialog, "showModal", {
        value: () => {
          dialog.open = true;
        },
      });

      const blue = yield* Effect.fromOption(
        Option.fromNullishOr(
          element.querySelector<HTMLButtonElement>("#event-color-7")
        )
      );

      const calendar = yield* Effect.fromOption(
        Option.fromNullishOr(
          element.querySelector<HTMLButtonElement>("#event-color")
        )
      );

      const title = yield* Effect.fromOption(
        Option.fromNullishOr(
          element.querySelector<HTMLInputElement>("#event-title")
        )
      );

      expect(
        [...element.querySelectorAll("[autofocus]")].map((node) => node.id)
      ).toEqual(["event-color-7"]);
      const first = yield* Deferred.make<boolean>();
      blue.addEventListener(
        "focus",
        () => {
          Deferred.doneUnsafe(first, Effect.succeed(true));
        },
        { once: true }
      );

      const mounted = yield* Effect.forkChild(
        PrepareEditingDialogs({ person: staged.model.person })
          .f(element, Stream.never)
          .pipe(Stream.runHead)
      );

      yield* Deferred.await(first);
      expect(document.activeElement).toBe(blue);

      const reset = update(
        staged.model,
        Message.KeyboardAction({ id: "color:calendar" })
      );

      expect(reset.model.keyboard.focus).toBe("event-color");
      expect(
        yield* focusAfterMutation(element, () => {
          dialog.dataset.initialFocus = reset.model.keyboard.focus;
        })
      ).toBe("event-color");
      expect(document.activeElement).toBe(calendar);

      const picked = update(
        reset.model,
        Message.KeyboardAction({ id: "color:7" })
      );

      expect(picked.model.keyboard.focus).toBe("event-color-7");
      expect(
        yield* focusAfterMutation(element, () => {
          dialog.dataset.initialFocus = picked.model.keyboard.focus;
        })
      ).toBe("event-color-7");
      expect(document.activeElement).toBe(blue);
      expect(title.disabled).toBe(false);
      title.value = "Unsaved typing survives a card";
      title.focus();
      expect(document.activeElement).toBe(title);
      const { model: arrived } = reminderCardScene("prompt", "light", 1440);

      const cards = yield* renderToString(
        {
          init: () => ({ model: arrived }),
          view,
        },
        { isHydratable: false }
      );

      const settled = yield* Deferred.make<string>();

      const observer = new MutationObserver(() => {
        Deferred.doneUnsafe(
          settled,
          Effect.succeed(document.activeElement?.id ?? "")
        );
      });

      observer.observe(element, { childList: true, subtree: true });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          observer.disconnect();
        })
      );
      const incoming = document.createElement("div");
      incoming.innerHTML = cards.html;
      expect(incoming.querySelector("[autofocus]")).toBeNull();
      element.append(incoming);
      expect(yield* Deferred.await(settled)).toBe("event-title");
      expect(title.value).toBe("Unsaved typing survives a card");
      dialog.dispatchEvent(
        new Event("cancel", { bubbles: true, cancelable: true })
      );
      expect(Option.isSome(yield* Fiber.join(mounted))).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer))
);
